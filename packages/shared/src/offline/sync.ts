// Ported from dw-time-web/src/lib/offline/sync.ts — the queued-mutation
// drain-on-reconnect logic is unchanged. What's injected instead of
// imported: the module-level `queryClient` singleton (now `invalidateQueries`),
// `useOfflineQueueStore` (now `onPendingCountChange`), `react-hot-toast`
// (now `notify`), and TanStack's `onlineManager` (now `isOnline` /
// `subscribeOnline`, since even importing `onlineManager` ties this module
// to one global instance shared across every consumer in the process).

import type { QueryKey } from '@tanstack/react-query'

import { hasResponse } from './http-error'
import type { Outbox } from './outbox'
import type { OperationRegistry } from './registry'

const DEFAULT_MAX_RETRIES = 5

export interface OfflineSyncConfig {
  outbox: Outbox
  registry: OperationRegistry
  isOnline: () => boolean
  subscribeOnline: (callback: (online: boolean) => void) => () => void
  invalidateQueries: (queryKey: QueryKey) => void
  notify?: (message: string, kind: 'success' | 'error') => void
  onPendingCountChange?: (count: number) => void
  maxRetries?: number
}

export interface OfflineSync {
  drainOutbox(): Promise<void>
  refreshPendingCount(): Promise<void>
  /** Kicks off an initial drain + subscribes to reconnect events. Returns an unsubscribe function. */
  init(): () => void
}

export function createOfflineSync(config: OfflineSyncConfig): OfflineSync {
  const {
    outbox,
    registry,
    isOnline,
    subscribeOnline,
    invalidateQueries,
    notify,
    onPendingCountChange,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = config

  let draining = false

  async function refreshPendingCount(): Promise<void> {
    onPendingCountChange?.(await outbox.getOutboxCount())
  }

  async function drainOutbox(): Promise<void> {
    if (draining || !isOnline()) return
    draining = true

    let synced = 0
    let dropped = 0
    const keysToInvalidate = new Set<QueryKey>()

    try {
      const entries = await outbox.getOutbox()
      for (const entry of entries) {
        if (!isOnline()) break

        const operation = registry.getOperation(entry.kind)
        if (!operation) {
          await outbox.removeFromOutbox(entry.id)
          continue
        }

        try {
          await operation.execute(entry.payload, entry.idempotencyKey)
          await outbox.removeFromOutbox(entry.id)
          synced++
          operation.invalidateKeys?.forEach((key) => keysToInvalidate.add(key))
        } catch (err) {
          if (!hasResponse(err)) break // still offline — keep the entry and stop

          const status = err.response.status
          const isServerError = status >= 500
          if (isServerError && entry.retries + 1 < maxRetries) {
            await outbox.bumpRetries(entry.id)
            break
          }

          await outbox.removeFromOutbox(entry.id)
          dropped++
          operation.invalidateKeys?.forEach((key) => keysToInvalidate.add(key))

          try {
            operation.onDropped?.(entry.payload, err)
          } catch {
            // A hook throwing shouldn't take the rest of the drain down with
            // it — the entry it was about is already gone from the outbox
            // either way, so the drop itself already happened correctly.
          }
        }
      }
    } finally {
      draining = false
      await refreshPendingCount()
      keysToInvalidate.forEach((key) => invalidateQueries(key))

      if (synced > 0) {
        notify?.(`Synced ${synced} offline ${synced === 1 ? 'change' : 'changes'}`, 'success')
      }
      if (dropped > 0) {
        notify?.(`${dropped} offline ${dropped === 1 ? 'change' : 'changes'} could not be synced`, 'error')
      }
    }
  }

  function init(): () => void {
    void refreshPendingCount()
    void drainOutbox()
    return subscribeOnline((online) => {
      if (online) void drainOutbox()
    })
  }

  return { drainOutbox, refreshPendingCount, init }
}
