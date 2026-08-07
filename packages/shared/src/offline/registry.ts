// Ported from dw-time-web/src/lib/offline/registry.ts. Turned into a
// factory (rather than a module-level `Map` singleton) to match the rest of
// this package's injected-ports pattern — a mobile app and its test suite
// (or a web app and its test suite) shouldn't share one process-wide
// registry by accident.

import type { OfflineOperation } from './types'

export interface OperationRegistry {
  registerOperation<TPayload, TResult>(kind: string, operation: OfflineOperation<TPayload, TResult>): void
  getOperation(kind: string): OfflineOperation | undefined
}

export function createOperationRegistry(): OperationRegistry {
  const registry = new Map<string, OfflineOperation>()

  return {
    registerOperation(kind, operation) {
      registry.set(kind, operation as OfflineOperation)
    },
    getOperation(kind) {
      return registry.get(kind)
    },
  }
}
