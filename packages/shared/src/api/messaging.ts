// Two clients, because messaging spans two services with two different
// credentials. See ../types/messaging.ts for why the split exists at all.
//
//   createMessagingApi(api)          -> GoalSlot's API, the user's normal
//                                       session token, via the shared axios
//                                       instance (so it inherits the 401
//                                       refresh-and-retry interceptor).
//   createMessagingServiceClient(..) -> jiffy-messaging, authenticated with
//                                       the short-lived JWT the call above
//                                       mints.
//
// The service client is a factory taking a *getter* for its base URL rather
// than the URL itself. The feature is configuration-gated (the URLs come from
// app config and are frequently unset — dev builds, forks, the web app before
// the service is deployed), and a factory that throws at construction time
// would take the whole app down at import. Instead it constructs happily with
// nothing configured and every call rejects with a `MessagingError` of kind
// 'not-configured', which the UI can treat as "feature off" without a crash.

import axios, { type AxiosInstance, type AxiosError } from 'axios'

import type {
  CreateMessagingConversationInput,
  MessagingConversation,
  MessagingMessage,
  MessagingTokenResponse,
  OpenMessagingConversationResponse,
} from '../types/messaging'

// ---------------------------------------------------------------------------
// GoalSlot API side
// ---------------------------------------------------------------------------

export function createMessagingApi(api: AxiosInstance) {
  return {
    /** Short-lived JWT for jiffy-messaging. */
    issueToken: () => api.post<MessagingTokenResponse>('/messaging/token'),
    /**
     * Opens (or returns the existing) conversation with another GoalSlot
     * user. The sharing-relationship check is server-side and answers 403
     * when there isn't one — never pre-empt it client-side beyond hiding the
     * button, because the client's copy of the sharing graph is a cache.
     */
    createConversation: (input: CreateMessagingConversationInput) =>
      api.post<OpenMessagingConversationResponse>('/messaging/conversations', input),
  }
}

// ---------------------------------------------------------------------------
// jiffy-messaging service side
// ---------------------------------------------------------------------------

/**
 * Every failure mode jiffy-messaging documents (400/401/403/404/429), plus
 * the two the network gives us for free. Callers switch on `kind` instead of
 * re-deriving meaning from a status code at each call site — and the UI can
 * say "you're offline" rather than "Request failed with status code
 * undefined".
 */
export type MessagingErrorKind =
  | 'not-configured'
  | 'bad-request'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'unknown'

export class MessagingError extends Error {
  readonly kind: MessagingErrorKind
  readonly status?: number

  constructor(kind: MessagingErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'MessagingError'
    this.kind = kind
    this.status = status
  }
}

const MESSAGES: Record<MessagingErrorKind, string> = {
  'not-configured': 'Messaging is not available in this build.',
  'bad-request': "That message couldn't be sent.",
  unauthorized: 'Your messaging session expired.',
  forbidden: "You're not part of this conversation.",
  'not-found': 'That conversation no longer exists.',
  'rate-limited': "You're sending messages too quickly. Give it a moment.",
  server: 'Messaging is having trouble right now.',
  network: "Couldn't reach messaging. Check your connection.",
  unknown: 'Something went wrong with messaging.',
}

function kindForStatus(status: number | undefined): MessagingErrorKind {
  if (status === undefined) return 'network'
  if (status === 400) return 'bad-request'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'unknown'
}

/** Normalises anything thrown by axios (or by us) into a MessagingError. */
export function toMessagingError(error: unknown): MessagingError {
  if (error instanceof MessagingError) return error
  const status = (error as AxiosError | undefined)?.response?.status
  const kind = kindForStatus(status)
  return new MessagingError(kind, MESSAGES[kind], status)
}

export interface MessagingServiceConfig {
  /**
   * Origin of the jiffy-messaging deployment, e.g. "https://messaging.goalslot.io".
   * Returning an empty string (or undefined) means "not configured" and every
   * call rejects with kind 'not-configured' instead of hitting a bogus URL.
   */
  getBaseUrl: () => string | undefined
  /**
   * Supplies the messaging JWT. Called before every request, so the
   * implementation is expected to cache — see ../messaging/token.ts.
   * `forceRefresh` is passed after a 401 to mint a fresh one.
   */
  getToken: (options?: { forceRefresh?: boolean }) => Promise<string>
}

export interface ListMessagesOptions {
  limit?: number
  /** ISO instant — returns messages strictly older than this, for paging back. */
  before?: string
}

export function createMessagingServiceClient(config: MessagingServiceConfig) {
  const { getBaseUrl, getToken } = config

  // One axios instance, but the baseURL is resolved per request: app config
  // can arrive after this module is imported (Expo's Constants, a remote
  // flag), so baking it in at construction would freeze whatever was known
  // at import time.
  const http: AxiosInstance = axios.create({
    headers: { 'Content-Type': 'application/json' },
  })

  async function request<T>(
    method: 'get' | 'post',
    path: string,
    options: { params?: Record<string, unknown>; data?: unknown } = {},
    // Internal: set on the single retry after a 401 so a permanently rejected
    // token can't spin.
    isRetry = false,
  ): Promise<T> {
    const baseUrl = getBaseUrl()
    if (!baseUrl) {
      throw new MessagingError('not-configured', MESSAGES['not-configured'])
    }

    let token: string
    try {
      token = await getToken({ forceRefresh: isRetry })
    } catch (error) {
      // A failure to mint the messaging JWT is a GoalSlot-API failure, not a
      // jiffy one, but it lands in exactly the same place for the user.
      throw toMessagingError(error)
    }

    try {
      const response = await http.request<T>({
        method,
        url: `${baseUrl.replace(/\/$/, '')}${path}`,
        params: options.params,
        data: options.data,
        headers: { Authorization: `Bearer ${token}` },
      })
      return response.data
    } catch (error) {
      const messagingError = toMessagingError(error)
      // Exactly one retry, and only for an expired token. 403 (not a
      // participant) is a real answer, not a stale credential — retrying it
      // would just ask the same question twice.
      if (messagingError.kind === 'unauthorized' && !isRetry) {
        return request<T>(method, path, options, true)
      }
      throw messagingError
    }
  }

  return {
    listConversations: () => request<MessagingConversation[]>('get', '/conversations'),

    getConversation: (id: string) => request<MessagingConversation>('get', `/conversations/${id}`),

    /** Oldest-first, per the service contract. */
    listMessages: (id: string, options: ListMessagesOptions = {}) =>
      request<MessagingMessage[]>('get', `/conversations/${id}/messages`, {
        params: {
          limit: options.limit ?? DEFAULT_PAGE_SIZE,
          ...(options.before ? { before: options.before } : {}),
        },
      }),

    sendMessage: (id: string, body: string) =>
      request<MessagingMessage>('post', `/conversations/${id}/messages`, { data: { body } }),

    /** 204 on success. Swallows the empty body so callers get a clean `void`. */
    markRead: async (id: string): Promise<void> => {
      await request<unknown>('post', `/conversations/${id}/read`)
    },
  }
}

/**
 * The service's own documented default. Kept here so the paging math in the
 * thread screen ("a short page means there is no more history") has one
 * number to compare against.
 */
export const DEFAULT_PAGE_SIZE = 50

/** Longest body the composer accepts before the send button disables. */
export const MAX_MESSAGE_LENGTH = 4000

export type MessagingServiceClient = ReturnType<typeof createMessagingServiceClient>
