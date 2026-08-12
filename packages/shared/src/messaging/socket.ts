// Live delivery. jiffy-messaging pushes every new message in every
// conversation the holder of the token participates in, over a plain
// WebSocket authenticated by a query parameter (browsers can't set headers on
// the upgrade — see the service README).
//
// Platform-neutral on purpose: `WebSocket` is a global in both React Native
// and browsers, and the one construction site is injectable so tests drive a
// fake socket rather than a real server. Everything mobile-specific
// (AppState, NetInfo, React Query) stays in the app layer, which calls
// `connect()`/`disconnect()` and hands the pushes to the cache reconcilers in
// ./cache.ts.
//
// The parts that are easy to get wrong, and what this does about them:
//
//   * A socket kept across a background/foreground cycle is usually already
//     dead but not yet reported as such. The app disconnects on background
//     and connects on resume rather than trusting a stale handle.
//   * A retry loop must not run while the device is offline — it burns
//     battery attempting a handshake that cannot complete. `isOnline` gates
//     scheduling; the app re-calls `connect()` on the reconnect event.
//   * Every previous socket must be fully detached before a new one is made,
//     handlers included. A leaked handler from a superseded socket delivers
//     messages the caller thinks it already unsubscribed from, which shows up
//     as duplicate rows much later and is miserable to trace back here.
//   * Reconnect delay is exponential with jitter. Without jitter, every
//     client that dropped when the service restarted comes back in the same
//     millisecond.

import type { MessagingMessage, MessagingSocketStatus } from '../types/messaging'

/** The subset of the WebSocket API this uses — keeps the fake in tests small. */
export interface MessagingSocketLike {
  close: (code?: number, reason?: string) => void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}

export interface MessagingSocketConfig {
  /** Origin of the messaging service's WebSocket, e.g. "wss://messaging.goalslot.io". Undefined disables the socket. */
  getWsUrl: () => string | undefined
  /** Mints/returns the messaging JWT. `forceRefresh` after an auth-looking close. */
  getToken: (options?: { forceRefresh?: boolean }) => Promise<string>
  /** Called for every well-formed push. */
  onMessage: (message: MessagingMessage) => void
  onStatusChange?: (status: MessagingSocketStatus) => void
  /** Connectivity gate — the app's existing NetInfo-backed check. */
  isOnline?: () => boolean
  /** Injectable constructor, for tests. Defaults to the global WebSocket. */
  createSocket?: (url: string) => MessagingSocketLike
  /** Injectable timers, for tests. */
  setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown
  clearTimeoutImpl?: (handle: unknown) => void
  /** Injectable randomness for the reconnect jitter, for tests. */
  random?: () => number
}

export interface MessagingSocket {
  connect: () => void
  disconnect: () => void
  getStatus: () => MessagingSocketStatus
}

const BASE_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30_000
/** WebSocket close code the service uses when the token is rejected/expired. */
const CLOSE_POLICY_VIOLATION = 1008

/**
 * Narrows an arbitrary parsed payload to a message. The socket is a network
 * boundary: a malformed frame (a service-side ping, a future event type, a
 * proxy injecting something) must be dropped, not written into the cache as a
 * bubble with `undefined` for a body.
 */
export function parseIncomingMessage(raw: unknown): MessagingMessage | null {
  if (typeof raw !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>

  const { id, conversationId, senderId, body, createdAt } = candidate
  if (
    typeof id !== 'string' ||
    typeof conversationId !== 'string' ||
    typeof senderId !== 'string' ||
    typeof body !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null
  }

  return { id, conversationId, senderId, body, createdAt }
}

/**
 * `wss://host` -> `wss://host/?token=...`, matching the service's documented
 * handshake URL. Exported for the test, because getting this subtly wrong
 * (a missing slash, a `&` where a `?` belongs) fails as a 400 on the upgrade
 * with no clue as to which half is at fault.
 */
export function buildSocketUrl(wsUrl: string, token: string): string {
  const withoutTrailingSlash = wsUrl.replace(/\/+$/, '')
  const separator = withoutTrailingSlash.includes('?') ? '&' : '/?'
  return `${withoutTrailingSlash}${separator}token=${encodeURIComponent(token)}`
}

/** Full jitter: a random point in [0, exponential delay]. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_RECONNECT_DELAY_MS)
  return Math.round(random() * ceiling)
}

export function createMessagingSocket(config: MessagingSocketConfig): MessagingSocket {
  const {
    getWsUrl,
    getToken,
    onMessage,
    onStatusChange,
    isOnline = () => true,
    createSocket = defaultCreateSocket,
    setTimeoutImpl = (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeoutImpl = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    random = Math.random,
  } = config

  let socket: MessagingSocketLike | null = null
  let status: MessagingSocketStatus = 'idle'
  let attempt = 0
  let reconnectHandle: unknown = null
  // Guards against a resolved token arriving after disconnect() — without it,
  // an in-flight `getToken()` opens a socket nobody is listening to.
  let generation = 0
  let wantConnection = false

  function setStatus(next: MessagingSocketStatus): void {
    if (status === next) return
    status = next
    onStatusChange?.(next)
  }

  function detach(): void {
    if (!socket) return
    // Handlers first, THEN close: close() fires onclose synchronously in some
    // implementations, which would otherwise re-enter the reconnect path for
    // a socket we are deliberately discarding.
    socket.onopen = null
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    try {
      socket.close()
    } catch {
      // A socket already closed by the platform throws on close in some
      // runtimes; there is nothing to recover and nothing to report.
    }
    socket = null
  }

  function clearReconnect(): void {
    if (reconnectHandle !== null) {
      clearTimeoutImpl(reconnectHandle)
      reconnectHandle = null
    }
  }

  function scheduleReconnect(): void {
    if (!wantConnection || reconnectHandle !== null) return
    // Offline: don't retry on a timer. The app re-calls connect() when
    // connectivity returns, which is both faster and cheaper than polling.
    if (!isOnline()) {
      setStatus('closed')
      return
    }
    attempt += 1
    setStatus('reconnecting')
    reconnectHandle = setTimeoutImpl(() => {
      reconnectHandle = null
      openSocket()
    }, reconnectDelayMs(attempt, random))
  }

  function openSocket(): void {
    if (!wantConnection) return

    const wsUrl = getWsUrl()
    if (!wsUrl) {
      // Not configured. Stay idle forever rather than retrying — no amount of
      // waiting produces a URL.
      setStatus('idle')
      return
    }
    if (!isOnline()) {
      setStatus('closed')
      return
    }

    detach()
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

    const thisGeneration = ++generation
    // A reconnect after an auth-looking close mints a fresh token; the first
    // attempt of a session reuses whatever is cached.
    void getToken({ forceRefresh: attempt > 0 })
      .then((token) => {
        if (!wantConnection || thisGeneration !== generation) return

        const next = createSocket(buildSocketUrl(wsUrl, token))
        socket = next

        next.onopen = () => {
          if (thisGeneration !== generation) return
          attempt = 0
          setStatus('open')
        }

        next.onmessage = (event) => {
          if (thisGeneration !== generation) return
          const message = parseIncomingMessage(event.data)
          if (message) onMessage(message)
        }

        next.onerror = () => {
          // Intentionally silent: `onerror` carries no actionable detail in
          // either runtime and is always followed by `onclose`, which is
          // where the reconnect decision belongs.
        }

        next.onclose = (event) => {
          if (thisGeneration !== generation) return
          socket = null
          const code = (event as { code?: number } | undefined)?.code
          if (code === CLOSE_POLICY_VIOLATION) {
            // Token rejected. Count it as an attempt so the next open forces
            // a refresh rather than presenting the same dead credential.
            attempt = Math.max(attempt, 1)
          }
          scheduleReconnect()
        }
      })
      .catch(() => {
        if (!wantConnection || thisGeneration !== generation) return
        // Couldn't mint a token (offline, session expired, service down).
        // Same backoff as a dropped socket.
        scheduleReconnect()
      })
  }

  return {
    connect() {
      wantConnection = true
      clearReconnect()
      // A live socket is left alone: reconnecting an open connection drops
      // messages for no reason. Foregrounding calls this unconditionally, so
      // this check is load-bearing, not defensive.
      if (socket && status === 'open') return
      attempt = 0
      openSocket()
    },

    disconnect() {
      wantConnection = false
      // Bumping the generation orphans any in-flight token promise, so it
      // can't open a socket after this point.
      generation += 1
      clearReconnect()
      detach()
      attempt = 0
      setStatus('idle')
    },

    getStatus() {
      return status
    },
  }
}

function defaultCreateSocket(url: string): MessagingSocketLike {
  // `WebSocket` is global in React Native and in browsers. Node before 22
  // has none, which is why tests inject `createSocket`.
  return new WebSocket(url) as unknown as MessagingSocketLike
}
