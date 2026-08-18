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

// Every offline call site above was using `hasResponse` as a binary
// queue-vs-fail gate: "the server responded at all" was treated as "this is
// a genuine, non-retryable rejection." That conflates a 400/404/409/422
// (the server looked at the request and said no — queuing it would just
// fail again identically) with a 500/502/503/504 (the server, or a reverse
// proxy in front of it, failed transiently — often mid-deploy — and the
// exact same request would very likely succeed on retry). The latter was
// being shown to the user as a hard "couldn't save" failure and NOT queued,
// so a dictated note/goal/task edit that happened to land during a backend
// restart was silently lost instead of retried.
//
// `isRetryable` is the real question every call site actually needs to ask:
// "should this failure queue for later instead of surfacing as final?" No
// response at all (offline/timeout) and any 5xx both answer yes; a 4xx
// (the server definitively rejected this specific request) answers no.
export function isRetryable(err: unknown): boolean {
  if (!hasResponse(err)) return true // no response at all: offline/timeout
  return err.response.status >= 500 // 5xx: transient server/gateway failure
}
