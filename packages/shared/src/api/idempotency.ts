// The client half of goal-slot-api's global `IdempotencyInterceptor`
// (src/shared/idempotency/idempotency.interceptor.ts), which has been
// registered as an `APP_INTERCEPTOR` on every mutating route for a while but
// had no caller anywhere in this package until now.
//
// The server contract, exactly as that interceptor implements it:
//
//   - The header is spelled `idempotency-key`, lowercase. It is read as
//     `req.headers['idempotency-key']`, and Node lowercases incoming header
//     names, so the casing sent on the wire doesn't matter — but the spelling
//     does, and it is the one thing a client can get silently wrong: an
//     unrecognised header is not an error, it just means no deduplication
//     happens at all. Hence the constant rather than a string literal at each
//     call site.
//   - It only engages for POST/PUT/PATCH/DELETE on an authenticated request
//     (it keys records by `req.user.sub`), which is every write this package
//     makes.
//   - A key that has been seen before replays the ORIGINAL response — the
//     stored status code and body — without re-running the handler. That is
//     what makes it usable as a duplicate-suppressor rather than just a
//     duplicate-detector: the caller gets back the resource that was created
//     the first time, and cannot tell (or care) which attempt created it.
//   - Records are hashed on method + route pattern + request body and expire
//     after 24h. Reusing one key with a DIFFERENT body is a 409, so a key
//     must be minted per logical operation and then held constant across
//     every retry of that same payload — never regenerated per attempt, and
//     never shared between two operations.
//   - Only a response that made it through the handler is stored; a rejection
//     (the 403 plan-limit case, say) is not. A key burned on a rejected
//     request is therefore still usable later, which is what allows the
//     Time Tracker's Retry button to work after a cap resets.
//
// WHY this matters beyond ordinary retry hygiene: this client sets a 20s
// timeout (see ./client.ts), and a request that times out has still very
// possibly been committed server-side — the client simply stopped waiting for
// the answer. Every caller in this package treats "no response" as "the
// server never saw it" and queues the payload for replay, which without a
// stable key across the live attempt AND its replays inserts the row a second
// time. Passing one key through both is what makes that assumption safe.

import type { AxiosRequestConfig } from 'axios'

/** The exact header name goal-slot-api's `IdempotencyInterceptor` reads. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'

export interface IdempotentRequestOptions {
  /**
   * Stable per logical operation, NOT per attempt. The same value must be
   * sent by the first live attempt and by every subsequent replay of the same
   * payload (an outbox drain, a Retry button) — that identity is the whole
   * mechanism. Omitted entirely, the request behaves exactly as it did before
   * this option existed: no header, no server-side dedupe.
   */
  idempotencyKey?: string
}

/**
 * Builds the per-request axios config that carries an idempotency key, or
 * `undefined` when there is no key to send — so passing the result straight
 * through to `api.post(url, body, ...)` is identical to omitting the argument
 * for callers that don't supply one.
 */
export function idempotentConfig(options?: IdempotentRequestOptions): AxiosRequestConfig | undefined {
  const key = options?.idempotencyKey
  if (!key) return undefined
  return { headers: { [IDEMPOTENCY_KEY_HEADER]: key } }
}
