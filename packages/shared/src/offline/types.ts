// Ported from dw-time-web/src/lib/offline/types.ts, plus the new
// OfflineStorage seam (see ./outbox) that replaces the web version's direct
// `idb-keyval` import.

import type { QueryKey } from '@tanstack/react-query'

/**
 * Minimal async key/value storage adapter the outbox is built on. Web wires
 * this to idb-keyval, mobile wires it to AsyncStorage — this package never
 * imports either directly.
 */
export interface OfflineStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  del(key: string): Promise<void>
}

export interface OutboxEntry {
  id: string
  kind: string
  payload: unknown
  idempotencyKey: string
  createdAt: number
  retries: number
}

export interface OfflineOperation<TPayload = unknown, TResult = unknown> {
  execute: (payload: TPayload, idempotencyKey: string) => Promise<TResult>
  invalidateKeys?: QueryKey[]
  /**
   * Called when the sync engine drops this operation's outbox entry because
   * the server gave it a response rather than nothing — either an outright
   * rejection (a non-5xx status, so replaying the same payload again could
   * never succeed) or a 5xx that kept recurring until `maxRetries` was
   * exhausted. Never called for a network-style failure (no response at
   * all); that leaves the entry queued instead of dropping it — see
   * `drainOutbox` in ./sync.
   *
   * Optional, and the safe default for an operation that doesn't set one is
   * exactly today's behaviour: the entry is dropped silently apart from the
   * engine's own aggregate `notify` summary ("N offline changes could not be
   * synced"), which fires regardless of whether any operation registers
   * this hook. Set it when a drop needs its own user-facing reaction —
   * `messaging-send` already reacts to a definite rejection this way, just
   * inline inside its own `execute` rather than through this hook, because
   * it needs to patch a cache entry synchronously with the throw rather than
   * after the outbox entry is gone.
   */
  onDropped?: (payload: TPayload, error: unknown) => void
}

export interface OfflineMeta {
  entityId: string
  idempotencyKey: string
}
