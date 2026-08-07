import { describe, expect, it } from 'vitest'

import type { OfflineStorage, OutboxEntry } from './types'
import { createOutbox } from './outbox'

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

function makeEntry(id: string): OutboxEntry {
  return { id, kind: 'test.op', payload: { id }, idempotencyKey: `idem-${id}`, createdAt: Date.now(), retries: 0 }
}

describe('createOutbox', () => {
  it('starts empty', async () => {
    const outbox = createOutbox(createMemoryStorage())
    expect(await outbox.getOutbox()).toEqual([])
    expect(await outbox.getOutboxCount()).toBe(0)
  })

  it('adds, counts, and removes entries', async () => {
    const outbox = createOutbox(createMemoryStorage())
    await outbox.addToOutbox(makeEntry('a'))
    await outbox.addToOutbox(makeEntry('b'))
    expect(await outbox.getOutboxCount()).toBe(2)

    await outbox.removeFromOutbox('a')
    const remaining = await outbox.getOutbox()
    expect(remaining.map((e) => e.id)).toEqual(['b'])
  })

  it('bumps retries on the matching entry only', async () => {
    const outbox = createOutbox(createMemoryStorage())
    await outbox.addToOutbox(makeEntry('a'))
    await outbox.addToOutbox(makeEntry('b'))

    await outbox.bumpRetries('a')
    const entries = await outbox.getOutbox()
    expect(entries.find((e) => e.id === 'a')?.retries).toBe(1)
    expect(entries.find((e) => e.id === 'b')?.retries).toBe(0)
  })

  it('serializes concurrent mutations instead of losing writes to a race', async () => {
    const outbox = createOutbox(createMemoryStorage())
    await Promise.all(Array.from({ length: 20 }, (_, i) => outbox.addToOutbox(makeEntry(`e${i}`))))
    expect(await outbox.getOutboxCount()).toBe(20)
  })

  it('persists through the injected storage adapter, not a hidden global', async () => {
    const storage = createMemoryStorage()
    const outboxA = createOutbox(storage)
    await outboxA.addToOutbox(makeEntry('a'))

    // A second outbox instance over the SAME storage sees the same data...
    const outboxB = createOutbox(storage)
    expect(await outboxB.getOutboxCount()).toBe(1)

    // ...but a fresh in-memory storage is fully isolated.
    const outboxC = createOutbox(createMemoryStorage())
    expect(await outboxC.getOutboxCount()).toBe(0)
  })
})
