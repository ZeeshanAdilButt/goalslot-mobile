import axios, { type AxiosInstance } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { describe, expect, it } from 'vitest'

import { createApiClient } from './client'
import { createOfflineSync } from '../offline/sync'
import { createOperationRegistry } from '../offline/registry'
import { createOutbox } from '../offline/outbox'
import type { OfflineStorage } from '../offline/types'
import { IDEMPOTENCY_KEY_HEADER } from './idempotency'
import { createTimeEntriesApi } from './time-entries'
import type { CreateTimeEntryInput } from '../validation/time-entry'

const PAYLOAD: CreateTimeEntryInput = {
  taskName: 'Untitled session',
  duration: 1,
  date: '2026-08-14',
}

/**
 * A stand-in for goal-slot-api's global `IdempotencyInterceptor` plus the
 * time-entries handler behind it, faithful to the two behaviours this client
 * depends on: a key seen before replays the ORIGINAL status and body without
 * re-running the handler, and a request with no key always inserts.
 *
 * `rows` is the assertion surface — it is the Timer history the user sees.
 */
function fakeServer() {
  const rows: CreateTimeEntryInput[] = []
  const records = new Map<string, { status: number; body: unknown }>()

  return {
    rows,
    handle(headers: Record<string, unknown> | undefined, body: CreateTimeEntryInput) {
      const key = headers?.[IDEMPOTENCY_KEY_HEADER] as string | undefined

      if (key) {
        const stored = records.get(key)
        if (stored) return stored
      }

      rows.push(body)
      const response = { status: 201, body: { id: `entry-${rows.length}`, ...body } }
      if (key) records.set(key, response)
      return response
    },
  }
}

/**
 * The exact failure this whole mechanism exists for: the request reached the
 * server and committed, and only THEN did the client stop waiting. Shaped
 * like a real axios timeout — crucially, with no `.response`, which is what
 * makes every call site in this codebase treat it as "never sent" and queue
 * the payload for replay.
 */
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

/**
 * Wires the fake server to an axios instance, with control over which
 * attempts are cut short client-side while still being processed serverside.
 */
function harness() {
  const server = fakeServer()
  const api: AxiosInstance = axios.create({ baseURL: 'https://api.test/api' })
  const mock = new MockAdapter(api)
  let timeOutNextAttempts = 0

  mock.onPost('/time-entries').reply((config) => {
    // The server ALWAYS processes the request — that is the entire premise of
    // the bug. Whether the client is still listening is a separate question.
    const result = server.handle(
      config.headers as unknown as Record<string, unknown> | undefined,
      JSON.parse(config.data as string) as CreateTimeEntryInput,
    )

    if (timeOutNextAttempts > 0) {
      timeOutNextAttempts--
      return Promise.reject(timeoutError())
    }
    return [result.status, result.body]
  })

  return {
    server,
    mock,
    timeEntries: createTimeEntriesApi(api),
    timeOutNext(count: number) {
      timeOutNextAttempts = count
    },
  }
}

describe('createTimeEntriesApi.create', () => {
  it('sends the key under the exact header the API interceptor reads', async () => {
    const { timeEntries, mock } = harness()

    await timeEntries.create(PAYLOAD, { idempotencyKey: 'key-1' })

    // Spelling is the one thing a client can get silently wrong here: an
    // unrecognised header is not an error, it just means no dedupe happens at
    // all. Pinned as a literal rather than through the constant so a rename
    // of the constant can't silently take the wire format with it — the
    // server reads `req.headers['idempotency-key']`.
    expect(mock.history.post[0]?.headers?.['idempotency-key']).toBe('key-1')
    expect(IDEMPOTENCY_KEY_HEADER).toBe('idempotency-key')
  })

  it('survives the auth interceptor on a real client', async () => {
    // The per-request header and the request interceptor's
    // `headers.set('Authorization', ...)` both write to the same
    // AxiosHeaders instance, so this pins that they coexist — a client that
    // sent the key but lost it on the way out would fail exactly the same way
    // as not sending it at all, silently.
    const client = createApiClient({
      baseUrl: 'https://api.test',
      storage: {
        getAccessToken: async () => 'token-123',
        getRefreshToken: async () => 'refresh-123',
        setTokens: async () => {},
        clear: async () => {},
      },
      onSessionExpired: () => {},
    })
    const mock = new MockAdapter(client.api)
    mock.onPost('/time-entries').reply(201, {})

    await client.timeEntries.create(PAYLOAD, { idempotencyKey: 'key-1' })

    expect(mock.history.post[0]?.headers?.['idempotency-key']).toBe('key-1')
    expect(mock.history.post[0]?.headers?.Authorization).toBe('Bearer token-123')
  })

  it('sends no idempotency header when no key is supplied', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const mock = new MockAdapter(api)
    mock.onPost('/time-entries').reply(201, {})

    await createTimeEntriesApi(api).create(PAYLOAD)

    expect(mock.history.post[0]?.headers?.[IDEMPOTENCY_KEY_HEADER]).toBeUndefined()
  })

  it('answers a replayed create with the original entry instead of inserting a second row', async () => {
    const { timeEntries, server } = harness()

    await timeEntries.create(PAYLOAD, { idempotencyKey: 'key-1' })
    const replay = await timeEntries.create(PAYLOAD, { idempotencyKey: 'key-1' })

    expect(server.rows).toHaveLength(1)
    // Not merely suppressed — the caller gets the row the FIRST attempt
    // created, so a replay is indistinguishable from a first success.
    expect(replay.data.id).toBe('entry-1')
  })
})

describe('time-entry create replay after a timeout', () => {
  /**
   * The reported bug, reproduced end to end through the real outbox and the
   * real sync engine: a create that times out AFTER committing, banked to the
   * outbox by the `hasResponse` check, then drained repeatedly (the engine
   * drains on mount and on every reconnect, and deliberately does NOT count a
   * no-response failure as a retry, so nothing bounds the number of replays).
   *
   * Before the key was threaded through, each drain inserted another row and
   * the only thing that ever stopped it was the FREE plan's 3-per-day cap
   * answering with a real 403 — which is why the user saw exactly three
   * identical rows.
   */
  async function drainScenario(replayKeyFor: (liveKey: string) => string) {
    const { timeEntries, server, timeOutNext } = harness()
    const outbox = createOutbox(createMemoryStorage())
    const registry = createOperationRegistry()

    registry.registerOperation<CreateTimeEntryInput, unknown>('time-entry-create', {
      // Mirrors apps/mobile/src/lib/offline.ts's registration.
      execute: async (payload, idempotencyKey) => (await timeEntries.create(payload, { idempotencyKey })).data,
    })

    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: () => {},
    })

    const liveKey = 'session-key-1'
    timeOutNext(1)
    await expect(timeEntries.create(PAYLOAD, { idempotencyKey: liveKey })).rejects.toThrow()

    // The row is already on the server; the client has no idea.
    expect(server.rows).toHaveLength(1)

    await outbox.addToOutbox({
      id: 'outbox-1',
      kind: 'time-entry-create',
      payload: PAYLOAD,
      idempotencyKey: replayKeyFor(liveKey),
      createdAt: Date.now(),
      retries: 0,
    })

    // Three drains: mount, plus two NetInfo online transitions.
    await sync.drainOutbox()
    await sync.drainOutbox()
    await sync.drainOutbox()

    return { server, outbox }
  }

  it('leaves exactly one row after a timed-out create is queued and drained', async () => {
    const { server, outbox } = await drainScenario((liveKey) => liveKey)

    expect(server.rows).toHaveLength(1)
    // The replay was answered, so the entry left the outbox on the first
    // drain rather than sitting there to be replayed forever.
    expect(await outbox.getOutbox()).toHaveLength(0)
  })

  it('would insert a duplicate if the replay minted a fresh key', async () => {
    // Guards the fix itself rather than the code around it: with a
    // per-attempt key — exactly what the enqueue sites used to write — the
    // server has nothing to match on and the session is logged twice. If this
    // ever stops producing a duplicate, the test above has stopped proving
    // anything.
    const { server } = await drainScenario(() => 'a-different-key')

    expect(server.rows).toHaveLength(2)
  })

  it('converges on one row even when the replay itself times out', async () => {
    // A replay that times out again is left queued WITHOUT counting a retry
    // (see sync.ts's no-response `break`, which is deliberate: bumping
    // retries there would discard genuinely-offline work). That is only safe
    // because repeated replays of one key converge instead of accumulating.
    const { timeEntries, server, timeOutNext } = harness()
    const outbox = createOutbox(createMemoryStorage())
    const registry = createOperationRegistry()

    registry.registerOperation<CreateTimeEntryInput, unknown>('time-entry-create', {
      execute: async (payload, idempotencyKey) => (await timeEntries.create(payload, { idempotencyKey })).data,
    })

    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: () => {},
    })

    timeOutNext(1)
    await expect(timeEntries.create(PAYLOAD, { idempotencyKey: 'k' })).rejects.toThrow()

    await outbox.addToOutbox({
      id: 'outbox-1',
      kind: 'time-entry-create',
      payload: PAYLOAD,
      idempotencyKey: 'k',
      createdAt: Date.now(),
      retries: 0,
    })

    // Two more drains cut short client-side, then one that completes.
    timeOutNext(2)
    await sync.drainOutbox()
    await sync.drainOutbox()
    await sync.drainOutbox()

    expect(server.rows).toHaveLength(1)
    expect(await outbox.getOutbox()).toHaveLength(0)
  })
})
