// Shared duck-type check for "did the server actually answer?" — the one
// signal every offline call site in this codebase needs to decide whether a
// failed mutation should queue (no response at all: offline/timeout) or
// surface as a genuine rejection (the server responded, it just said no).
//
// Previously reimplemented separately in this file's own `sync.ts` (as a
// private, unexported copy) and in apps/mobile/src/hooks/useQuickAdd.ts (as
// its own private copy, with a comment noting it "mirrors the same check").
// Consolidated here so every caller — the sync engine's own drain loop, the
// mobile app's quick-add flow, and the per-screen edit/complete/delete flows
// that now queue the same way — reads the exact same bytes instead of three
// independently-maintained copies that could drift.
export function hasResponse(err: unknown): err is { response: { status: number } } {
  return Boolean((err as { response?: unknown } | undefined)?.response)
}
