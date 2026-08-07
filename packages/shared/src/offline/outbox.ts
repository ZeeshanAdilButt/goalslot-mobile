// Ported from dw-time-web/src/lib/offline/outbox.ts. The only real change is
// the storage backend: the web version imported `idb-keyval` directly at
// module scope; this version takes an injected OfflineStorage adapter
// (`{ get, set, del }`) so web can wire idb-keyval and mobile can wire
// AsyncStorage without this package depending on either.

import type { OfflineStorage, OutboxEntry } from './types'

const DEFAULT_STORAGE_KEY = 'goalslot-offline-outbox'

export interface Outbox {
  getOutbox(): Promise<OutboxEntry[]>
  getOutboxCount(): Promise<number>
  addToOutbox(entry: OutboxEntry): Promise<OutboxEntry>
  removeFromOutbox(id: string): Promise<void>
  bumpRetries(id: string): Promise<void>
}

export function createOutbox(storage: OfflineStorage, storageKey: string = DEFAULT_STORAGE_KEY): Outbox {
  // Serialize all read-modify-write cycles through one promise chain so
  // concurrent enqueues can't clobber each other.
  let chain: Promise<unknown> = Promise.resolve()

  async function readEntries(): Promise<OutboxEntry[]> {
    return (await storage.get<OutboxEntry[]>(storageKey)) ?? []
  }

  function mutate<T>(op: (entries: OutboxEntry[]) => { next: OutboxEntry[]; result: T }): Promise<T> {
    const run = chain.then(async () => {
      const entries = await readEntries()
      const { next, result } = op(entries)
      await storage.set(storageKey, next)
      return result
    })
    chain = run.catch(() => undefined)
    return run
  }

  return {
    getOutbox: () => chain.then(readEntries),

    getOutboxCount: async () => (await chain.then(readEntries)).length,

    addToOutbox: (entry) => mutate((entries) => ({ next: [...entries, entry], result: entry })),

    removeFromOutbox: (id) =>
      mutate((entries) => ({ next: entries.filter((e) => e.id !== id), result: undefined })),

    bumpRetries: (id) =>
      mutate((entries) => ({
        next: entries.map((e) => (e.id === id ? { ...e, retries: e.retries + 1 } : e)),
        result: undefined,
      })),
  }
}
