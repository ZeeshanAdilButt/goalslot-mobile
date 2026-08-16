// Regression coverage for the idempotency-key gap audited across every
// mutation in the operation registry (apps/mobile/src/lib/offline.ts):
// commit 83d5536 closed it for "schedule-block-create" (and time-entries.ts's
// `create` had it from the start — see time-entries.test.ts for that
// operation's own end-to-end drain scenario). This file is the same
// end-to-end shape applied to the operations that turned out to have the
// identical gap: goal-create, task-create, task-complete, and note-create.
//
// goal-create and task-create are the clean case: a plain insert with no
// existing row to fall back on, so a client-side timeout followed by an
// outbox replay produces a second, real, silently-duplicated row.
//
// task-complete is the highest-severity of the four: TasksService.complete
// isn't just "insert a row" but "insert a TimeEntry AND recompute the goal's
// loggedHours", so a duplicated replay doesn't just leave clutter — it
// silently inflates a real number the user is tracking against.
//
// note-create is the odd one out: `CreateNoteDto.id` is client-generated, so
// a replay without a key doesn't produce a duplicate ROW (the second insert
// hits a unique constraint on id) — but without the key that collision comes
// back as an unmapped 500, which the sync engine's `isServerError` check
// reads as "still failing" and retries for `maxRetries` drains before
// dropping with a false "could not be synced" toast, for a create that
// already succeeded. Modelled here as a 409 (this package's server-shape
// stand-in for "id already exists") to keep the fake server here in one
// place rather than needing Prisma's actual error shape.

import axios, { type AxiosInstance } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { describe, expect, it } from 'vitest'

import { createGoalsApi } from './goals'
import { createTasksApi } from './tasks'
import { createNotesApi } from './notes'
import { IDEMPOTENCY_KEY_HEADER } from './idempotency'
import { createOfflineSync } from '../offline/sync'
import { createOperationRegistry } from '../offline/registry'
import { createOutbox } from '../offline/outbox'
import type { OfflineStorage } from '../offline/types'
import type { CreateGoalInput } from '../validation/goal'
import type { CompleteTaskInput, CreateTaskInput } from '../validation/task'
import type { CreateNoteDto } from '../types/note'

const GOAL_PAYLOAD: CreateGoalInput = {
  title: 'Read more',
  category: 'general',
  targetHours: 10,
}

const TASK_PAYLOAD: CreateTaskInput = { title: 'Buy milk' }

const COMPLETE_PAYLOAD: CompleteTaskInput = { actualMinutes: 30 }

const NOTE_PAYLOAD: CreateNoteDto = { id: 'note-client-id', title: 'Untitled page', content: '' }

function timeoutError(): Error & { code: string } {
  return Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' })
}

function createMemoryStorage(): OfflineStorage {
  const store = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      store.set(key, value)
    },
    del: async (key: string) => {
      store.delete(key)
    },
  }
}

describe('idempotency header forwarding on every create-shaped operation', () => {
  it('goal-create sends the key header', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    mock.onPost('/goals').reply(201, {})

    await createGoalsApi(api).create(GOAL_PAYLOAD, { idempotencyKey: 'key-1' })

    expect(mock.history.post[0]?.headers?.[IDEMPOTENCY_KEY_HEADER]).toBe('key-1')
  })

  it('task-create sends the key header', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    mock.onPost('/tasks').reply(201, {})

    await createTasksApi(api).create(TASK_PAYLOAD, { idempotencyKey: 'key-1' })

    expect(mock.history.post[0]?.headers?.[IDEMPOTENCY_KEY_HEADER]).toBe('key-1')
  })

  it('task-complete sends the key header', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    mock.onPost('/tasks/task-1/complete').reply(200, {})

    await createTasksApi(api).complete('task-1', COMPLETE_PAYLOAD, { idempotencyKey: 'key-1' })

    expect(mock.history.post[0]?.headers?.[IDEMPOTENCY_KEY_HEADER]).toBe('key-1')
  })

  it('note-create sends the key header', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    mock.onPost('/notes').reply(201, {})

    await createNotesApi(api).create(NOTE_PAYLOAD, { idempotencyKey: 'key-1' })

    expect(mock.history.post[0]?.headers?.[IDEMPOTENCY_KEY_HEADER]).toBe('key-1')
  })
})

describe('goal-create / task-create replay after a timeout', () => {
  /**
   * A minimal fake server: no key means every request inserts (the
   * pre-fix behaviour); a key seen before returns the ORIGINAL row instead
   * of inserting again.
   */
  function fakeServer<TPayload>() {
    const rows: TPayload[] = []
    const records = new Map<string, { status: number; body: unknown }>()
    return {
      rows,
      handle(headers: Record<string, unknown> | undefined, body: TPayload) {
        const key = headers?.[IDEMPOTENCY_KEY_HEADER] as string | undefined
        if (key) {
          const stored = records.get(key)
          if (stored) return stored
        }
        rows.push(body)
        const response = { status: 201, body: { id: `row-${rows.length}`, ...body } }
        if (key) records.set(key, response)
        return response
      },
    }
  }

  it('goal-create leaves exactly one Goal row after a timed-out create is queued and drained', async () => {
    const server = fakeServer<CreateGoalInput>()
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    const goals = createGoalsApi(api)
    let timeOutNext = 0
    mock.onPost('/goals').reply((config) => {
      const result = server.handle(config.headers as unknown as Record<string, unknown>, JSON.parse(config.data as string))
      if (timeOutNext > 0) {
        timeOutNext--
        return Promise.reject(timeoutError())
      }
      return [result.status, result.body]
    })

    const outbox = createOutbox(createMemoryStorage())
    const registry = createOperationRegistry()
    registry.registerOperation<CreateGoalInput, unknown>('goal-create', {
      // Mirrors apps/mobile/src/lib/offline.ts's "goal-create" registration.
      execute: async (payload, idempotencyKey) => (await goals.create(payload, { idempotencyKey })).data,
    })
    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: () => {},
    })

    const liveKey = 'attempt-key-1'
    timeOutNext = 1
    await expect(goals.create(GOAL_PAYLOAD, { idempotencyKey: liveKey })).rejects.toThrow()

    // The row is already on the server; the client has no idea.
    expect(server.rows).toHaveLength(1)

    // Mirrors useQuickAdd.ts's runQuickAdd: the SAME key reused for the
    // outbox entry, not a fresh one minted at queue time.
    await outbox.addToOutbox({
      id: 'outbox-1',
      kind: 'goal-create',
      payload: GOAL_PAYLOAD,
      idempotencyKey: liveKey,
      createdAt: Date.now(),
      retries: 0,
    })

    await sync.drainOutbox()

    expect(server.rows).toHaveLength(1)
    expect(await outbox.getOutbox()).toHaveLength(0)
  })

  it('task-complete replay does NOT double-log the same completion as a second TimeEntry', async () => {
    // Stands in for TasksService.complete: every call that reaches the
    // handler logs a new TimeEntry row, exactly like the real service (see
    // goal-slot-api's tasks.service.ts `complete`). This is the one op among
    // the four where a duplicate replay isn't just a stray row — it's a
    // silently-inflated logged-time number.
    const server = fakeServer<CompleteTaskInput>()
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    const tasks = createTasksApi(api)
    let timeOutNext = 0
    mock.onPost('/tasks/task-1/complete').reply((config) => {
      const result = server.handle(config.headers as unknown as Record<string, unknown>, JSON.parse(config.data as string))
      if (timeOutNext > 0) {
        timeOutNext--
        return Promise.reject(timeoutError())
      }
      return [result.status, result.body]
    })

    const outbox = createOutbox(createMemoryStorage())
    const registry = createOperationRegistry()
    registry.registerOperation<{ id: string; data: CompleteTaskInput }, unknown>('task-complete', {
      // Mirrors apps/mobile/src/lib/offline.ts's "task-complete" registration.
      execute: async (payload, idempotencyKey) =>
        (await tasks.complete(payload.id, payload.data, { idempotencyKey })).data,
    })
    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: () => {},
    })

    const liveKey = 'completion-key-1'
    timeOutNext = 1
    await expect(tasks.complete('task-1', COMPLETE_PAYLOAD, { idempotencyKey: liveKey })).rejects.toThrow()

    // The completion (and its TimeEntry) already committed server-side.
    expect(server.rows).toHaveLength(1)

    await outbox.addToOutbox({
      id: 'outbox-1',
      kind: 'task-complete',
      payload: { id: 'task-1', data: COMPLETE_PAYLOAD },
      idempotencyKey: liveKey,
      createdAt: Date.now(),
      retries: 0,
    })

    await sync.drainOutbox()

    // Still one — the replay was recognised as the same completion, not a
    // second one logging another 30 minutes on top of the first.
    expect(server.rows).toHaveLength(1)
    expect(await outbox.getOutbox()).toHaveLength(0)
  })

  it('would double-log task-complete if the replay minted a fresh key', async () => {
    // Guards the fix itself: with a per-attempt key (what a
    // `queueOfflineEdit` call with no idempotencyKey argument used to mint),
    // the server has nothing to match on and the completion is logged twice.
    const server = fakeServer<CompleteTaskInput>()
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    const tasks = createTasksApi(api)
    let timeOutNext = 0
    mock.onPost('/tasks/task-1/complete').reply((config) => {
      const result = server.handle(config.headers as unknown as Record<string, unknown>, JSON.parse(config.data as string))
      if (timeOutNext > 0) {
        timeOutNext--
        return Promise.reject(timeoutError())
      }
      return [result.status, result.body]
    })

    const outbox = createOutbox(createMemoryStorage())
    const registry = createOperationRegistry()
    registry.registerOperation<{ id: string; data: CompleteTaskInput }, unknown>('task-complete', {
      execute: async (payload, idempotencyKey) =>
        (await tasks.complete(payload.id, payload.data, { idempotencyKey })).data,
    })
    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: () => {},
    })

    timeOutNext = 1
    await expect(tasks.complete('task-1', COMPLETE_PAYLOAD, { idempotencyKey: 'live-key' })).rejects.toThrow()

    await outbox.addToOutbox({
      id: 'outbox-1',
      kind: 'task-complete',
      payload: { id: 'task-1', data: COMPLETE_PAYLOAD },
      idempotencyKey: 'a-different-key',
      createdAt: Date.now(),
      retries: 0,
    })

    await sync.drainOutbox()

    expect(server.rows).toHaveLength(2)
  })
})
