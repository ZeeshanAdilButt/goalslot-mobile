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
}

export interface OfflineMeta {
  entityId: string
  idempotencyKey: string
}
