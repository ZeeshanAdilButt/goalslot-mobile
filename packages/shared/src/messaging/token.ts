// Caches the short-lived messaging JWT so a screen that fires five requests
// on mount doesn't mint five tokens.
//
// Three things this has to get right, none of which are obvious:
//
//   1. Concurrent callers share one in-flight mint. Without that, the burst
//      of requests a thread screen makes on open (conversation + messages +
//      mark-read + socket connect) each miss the empty cache and each start
//      their own POST /messaging/token.
//   2. Expiry is advisory, never authoritative. `expiresAt` (when the server
//      sends it) only lets us skip sending a token we already know is dead;
//      a token can also be revoked early, so the real signal is a 401 from
//      jiffy-messaging, which the service client turns into
//      `getToken({ forceRefresh: true })`.
//   3. A forced refresh must not be satisfied by the in-flight mint that the
//      now-rejected token came from. Otherwise the 401 retry re-sends the
//      same dead token and fails identically.
//
// Deliberately does NOT decode the JWT. Base64/atob availability differs
// across Hermes, Node and browsers, and parsing a credential to guess its
// lifetime is strictly worse than being told or finding out.

import type { MessagingTokenResponse } from '../types/messaging'

export interface MessagingTokenStoreConfig {
  /** Calls POST /messaging/token on GoalSlot's API. */
  fetchToken: () => Promise<MessagingTokenResponse>
  /**
   * Assumed lifetime when the server doesn't send `expiresAt`. Short enough
   * that a rotated signing key self-heals within a minute or two, long enough
   * that a chat session isn't re-minting constantly.
   */
  defaultTtlMs?: number
  /**
   * Refresh this long before the stated expiry, so a token doesn't die
   * mid-flight on a slow connection.
   */
  skewMs?: number
  /** Injectable for tests. */
  now?: () => number
}

export interface MessagingTokenStore {
  getToken: (options?: { forceRefresh?: boolean }) => Promise<string>
  /** Drops the cached token. Called on sign-out — it belongs to one account. */
  clear: () => void
  /** The current token without minting one, for the WebSocket URL builder. */
  peek: () => string | null
}

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_SKEW_MS = 30 * 1000

export function createMessagingTokenStore(config: MessagingTokenStoreConfig): MessagingTokenStore {
  const { fetchToken, defaultTtlMs = DEFAULT_TTL_MS, skewMs = DEFAULT_SKEW_MS, now = Date.now } = config

  let token: string | null = null
  let expiresAtMs = 0
  let inFlight: Promise<string> | null = null

  function isFresh(): boolean {
    return token !== null && now() < expiresAtMs - skewMs
  }

  function mint(): Promise<string> {
    const pending = fetchToken()
      .then((response) => {
        token = response.token
        const stated = response.expiresAt ? Date.parse(response.expiresAt) : Number.NaN
        // `Number.isNaN` covers both "not sent" and "sent something
        // unparseable"; a bad date must not become an expiry of 1970 (refresh
        // storm) or NaN (never refresh).
        expiresAtMs = Number.isNaN(stated) ? now() + defaultTtlMs : stated
        return response.token
      })
      .finally(() => {
        // Cleared whether it resolved or rejected: a failed mint must not
        // pin every later caller to the same rejected promise.
        if (inFlight === pending) {
          inFlight = null
        }
      })

    inFlight = pending
    return pending
  }

  return {
    async getToken(options) {
      if (options?.forceRefresh) {
        // Invalidate first, so a concurrent non-forced caller that arrives
        // between here and the mint below doesn't get handed the token we
        // just learned is dead.
        token = null
        expiresAtMs = 0
        inFlight = null
        return mint()
      }
      if (isFresh() && token) return token
      if (inFlight) return inFlight
      return mint()
    },

    clear() {
      token = null
      expiresAtMs = 0
      inFlight = null
    },

    peek() {
      return isFresh() ? token : null
    },
  }
}
