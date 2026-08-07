// Ported as-is from dw-time-web/src/lib/offline/id.ts — already has a safe
// fallback for runtimes without crypto.randomUUID.

export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
