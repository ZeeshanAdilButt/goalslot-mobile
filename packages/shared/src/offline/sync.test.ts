import { describe, expect, it, vi } from 'vitest'

import { createOperationRegistry } from './registry'
import { createOfflineSync } from './sync'
import type { OfflineStorage, OutboxEntry } from './types'
import { createOutbox } from './outbox'

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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

function makeEntry(overrides: Partial<OutboxEntry> & Pick<OutboxEntry, 'id' | 'kind'>): OutboxEntry {
  return { payload: {}, idempotencyKey: `idem-${overrides.id}`, createdAt: Date.now(), retries: 0, ...overrides }
}

function harness() {
  const storage = createMemoryStorage()
  const outbox = createOutbox(storage)
  const registry = createOperationRegistry()
  const invalidateQueries = vi.fn()
  const notify = vi.fn()
  const onPendingCountChange = vi.fn()
  const sync = createOfflineSync({
    outbox,
    registry,
    isOnline: () => true,
    subscribeOnline: () => () => {},
    invalidateQueries,
    notify,
    onPendingCountChange,
  })
  return { outbox, registry, sync, invalidateQueries, notify, onPendingCountChange }
}

describe('createOfflineSync', () => {
  it('does nothing when offline', async () => {
    const { outbox, registry } = harness()
    const execute = vi.fn()
    registry.registerOperation('goal.create', { execute })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    const offlineSync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => false,
      subscribeOnline: () => () => {},
      invalidateQueries: vi.fn(),
    })

    await offlineSync.drainOutbox()
    expect(execute).not.toHaveBeenCalled()
    expect(await outbox.getOutboxCount()).toBe(1)
  })

  it('executes queued operations and removes them on success, invalidating their keys', async () => {
    const { outbox, registry, sync, invalidateQueries, notify } = harness()
    const execute = vi.fn().mockResolvedValue({ id: 'server-1' })
    registry.registerOperation('goal.create', { execute, invalidateKeys: [['goals']] })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create', payload: { title: 'Test' } }))

    await sync.drainOutbox()

    expect(execute).toHaveBeenCalledWith({ title: 'Test' }, 'idem-1')
    expect(await outbox.getOutboxCount()).toBe(0)
    expect(invalidateQueries).toHaveBeenCalledWith(['goals'])
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Synced 1'), 'success')
  })

  it('drops an entry with no registered operation', async () => {
    const { outbox, sync } = harness()
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'unknown.kind' }))

    await sync.drainOutbox()

    expect(await outbox.getOutboxCount()).toBe(0)
  })

  it('keeps the entry and stops draining on a network-style failure (no response)', async () => {
    const { outbox, registry, sync } = harness()
    const execute = vi.fn().mockRejectedValue(new Error('Network Error'))
    registry.registerOperation('goal.create', { execute })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))
    await outbox.addToOutbox(makeEntry({ id: '2', kind: 'goal.create' }))

    await sync.drainOutbox()

    expect(execute).toHaveBeenCalledTimes(1) // stopped after the first failure
    expect(await outbox.getOutboxCount()).toBe(2)
  })

  it('bumps retries and stops draining on a 5xx server error, under the retry cap', async () => {
    const { outbox, registry, sync } = harness()
    const execute = vi.fn().mockRejectedValue({ response: { status: 500 } })
    registry.registerOperation('goal.create', { execute })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    await sync.drainOutbox()

    const entries = await outbox.getOutbox()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.retries).toBe(1)
  })

  it('drops an entry once it exceeds the retry cap, notifying failure', async () => {
    const { outbox, registry, notify } = harness()
    const execute = vi.fn().mockRejectedValue({ response: { status: 500 } })
    registry.registerOperation('goal.create', { execute, invalidateKeys: [['goals']] })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create', retries: 4 }))

    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: vi.fn(),
      notify,
      maxRetries: 5,
    })

    await sync.drainOutbox()

    expect(await outbox.getOutboxCount()).toBe(0)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('could not be synced'), 'error')
  })

  it('drops (does not retry) a non-5xx client error like a 400/404, invalidating its keys', async () => {
    const { outbox, registry, sync } = harness()
    const execute = vi.fn().mockRejectedValue({ response: { status: 404 } })
    registry.registerOperation('goal.create', { execute })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    await sync.drainOutbox()

    expect(await outbox.getOutboxCount()).toBe(0)
  })

  it('calls the operation\'s onDropped hook with the payload and error on a definite (non-5xx) rejection', async () => {
    const { outbox, registry, sync } = harness()
    const rejection = { response: { status: 403 } }
    const execute = vi.fn().mockRejectedValue(rejection)
    const onDropped = vi.fn()
    registry.registerOperation('goal.create', { execute, onDropped })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create', payload: { title: 'Test' } }))

    await sync.drainOutbox()

    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onDropped).toHaveBeenCalledWith({ title: 'Test' }, rejection)
  })

  it('calls onDropped when a 5xx entry is dropped for exceeding the retry cap', async () => {
    const { outbox, registry } = harness()
    const rejection = { response: { status: 500 } }
    const execute = vi.fn().mockRejectedValue(rejection)
    const onDropped = vi.fn()
    registry.registerOperation('goal.create', { execute, onDropped })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create', retries: 4 }))

    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: vi.fn(),
      maxRetries: 5,
    })

    await sync.drainOutbox()

    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onDropped).toHaveBeenCalledWith(expect.anything(), rejection)
  })

  it('does not call onDropped on a network-style failure that leaves the entry queued for retry', async () => {
    const { outbox, registry, sync } = harness()
    const execute = vi.fn().mockRejectedValue(new Error('Network Error'))
    const onDropped = vi.fn()
    registry.registerOperation('goal.create', { execute, onDropped })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    await sync.drainOutbox()

    expect(onDropped).not.toHaveBeenCalled()
    expect(await outbox.getOutboxCount()).toBe(1)
  })

  it('does not call onDropped when a 5xx is bumped and retried under the cap (not yet dropped)', async () => {
    const { outbox, registry, sync } = harness()
    const execute = vi.fn().mockRejectedValue({ response: { status: 500 } })
    const onDropped = vi.fn()
    registry.registerOperation('goal.create', { execute, onDropped })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    await sync.drainOutbox()

    expect(onDropped).not.toHaveBeenCalled()
    expect(await outbox.getOutboxCount()).toBe(1)
  })

  it('does not require onDropped to be set — an operation that omits it drops silently, same as before', async () => {
    const { outbox, registry, sync, notify } = harness()
    const execute = vi.fn().mockRejectedValue({ response: { status: 400 } })
    registry.registerOperation('goal.create', { execute })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    await expect(sync.drainOutbox()).resolves.not.toThrow()

    expect(await outbox.getOutboxCount()).toBe(0)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('could not be synced'), 'error')
  })

  it('an onDropped hook that throws does not interrupt the drain of later entries', async () => {
    const { outbox, registry, sync } = harness()
    const execute = vi.fn().mockRejectedValue({ response: { status: 400 } })
    const throwingOnDropped = vi.fn(() => {
      throw new Error('boom')
    })
    registry.registerOperation('goal.create', { execute, onDropped: throwingOnDropped })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))
    await outbox.addToOutbox(makeEntry({ id: '2', kind: 'goal.create' }))

    await expect(sync.drainOutbox()).resolves.not.toThrow()

    expect(throwingOnDropped).toHaveBeenCalledTimes(2)
    expect(await outbox.getOutboxCount()).toBe(0)
  })

  it('reports pending count via the injected callback', async () => {
    const { outbox, registry, onPendingCountChange } = harness()
    registry.registerOperation('goal.create', { execute: vi.fn().mockResolvedValue(undefined) })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => true,
      subscribeOnline: () => () => {},
      invalidateQueries: vi.fn(),
      onPendingCountChange,
    })
    await sync.refreshPendingCount()

    expect(onPendingCountChange).toHaveBeenCalledWith(1)
  })

  it('init() drains immediately and again whenever connectivity is regained', async () => {
    const storage = createMemoryStorage()
    const outbox = createOutbox(storage)
    const registry = createOperationRegistry()
    const execute = vi.fn().mockResolvedValue(undefined)
    registry.registerOperation('goal.create', { execute })
    await outbox.addToOutbox(makeEntry({ id: '1', kind: 'goal.create' }))

    let online = true
    let onlineListener: ((online: boolean) => void) | undefined
    const sync = createOfflineSync({
      outbox,
      registry,
      isOnline: () => online,
      subscribeOnline: (cb) => {
        onlineListener = cb
        return () => {
          onlineListener = undefined
        }
      },
      invalidateQueries: vi.fn(),
    })

    const unsubscribe = sync.init()
    // init() fires drainOutbox() without awaiting it internally — flush the
    // task queue (drainOutbox chains several awaits, so a couple of bare
    // Promise.resolve() microtask flushes isn't enough).
    await flushAsync()
    expect(execute).toHaveBeenCalledTimes(1)

    await outbox.addToOutbox(makeEntry({ id: '2', kind: 'goal.create' }))
    online = false
    onlineListener?.(false)
    await flushAsync()
    expect(execute).toHaveBeenCalledTimes(1) // still offline, no drain

    online = true
    onlineListener?.(true)
    await flushAsync()
    expect(execute).toHaveBeenCalledTimes(2)

    unsubscribe()
  })
})
