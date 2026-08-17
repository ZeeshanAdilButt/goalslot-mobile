// Ported from dw-time-web/src/lib/api.ts — specifically the axios instance
// setup and the 401-retry-with-refresh-queue interceptor logic (originally
// lines ~1-174). That logic is good and is kept faithful; what changed is
// every direct `localStorage` / `window.location.href` touchpoint, which is
// now routed through the injected `TokenStorage` / `onSessionExpired`
// instead. This is a factory, not a module-level singleton — the web
// version registered interceptors once at module load and read
// `localStorage` directly inside them, which doesn't work for a package
// that also has to run inside React Native (no `window`, no `localStorage`,
// and potentially more than one authenticated context per process).

import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import type { ApiClientConfig } from './types'
import { createAuthApi } from './auth'
import { createCategoriesApi } from './categories'
import { createCoachApi, postCoachStream, type CoachStreamChunk } from './coach'
import { createCoachSettingsApi } from './coach-settings'
import { createGoalsApi } from './goals'
import { createInstructionsApi } from './instructions'
import { createJournalApi } from './journal'
import { createLabelsApi } from './labels'
import { createMessagingApi } from './messaging'
import { createNotesApi } from './notes'
import { createNotificationsApi } from './notifications'
import { createPushSubscriptionsApi } from './push-subscriptions'
import { createSharingApi } from './sharing'
import { createScheduleApi } from './schedule'
import { createTasksApi } from './tasks'
import { createTemplatesApi } from './templates'
import { createTimeEntriesApi } from './time-entries'
import { createTimerSessionApi } from './timer-session'
import { createUsersApi } from './users'

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

/**
 * Neither `axios.create()` below nor the raw `axios.post` refresh call ever
 * had a `timeout` — a request that the backend never responds to (no error,
 * no success, just silence) left the returned promise pending forever, with
 * nothing on the client able to notice or recover. Confirmed live: a
 * paused, unattributed `ActiveTimerSession` (no taskId/goalId) made both
 * POST /timer/session/stop and PATCH /timer/session hang indefinitely for
 * one specific account, which froze the Timer screen's Stop button (and,
 * because `stopping.current` in timer.tsx never got its `finally` to run,
 * left it permanently disabled) with no visible error. 20s is generous for
 * anything this API does — long enough that a slow-but-alive connection
 * still succeeds, short enough that a genuinely stuck request surfaces as a
 * normal, retryable network error instead of a silent, permanent hang.
 *
 * The refresh call gets the same timeout for a second reason: it runs
 * inside `isRefreshing`/`failedQueue` below, and every request queued
 * behind a 401 only ever settles when that refresh call itself settles. An
 * unbounded refresh call would therefore wedge every other in-flight
 * request through this same client instance, not just its own caller.
 */
const REQUEST_TIMEOUT_MS = 20_000

interface QueuedRequest {
  resolve: (token: string | null) => void
  reject: (error: unknown) => void
}

function isAuthFailureStatus(status: number | undefined): boolean {
  return status === 401 || status === 403
}

// Shared by both interceptors below: these endpoints must never carry a
// (possibly stale) bearer token, since they authenticate with credentials
// of their own and a leftover token from a previous session shouldn't ride
// along.
function isPublicAuthEndpoint(url: string): boolean {
  return (
    url.includes('/auth/refresh') ||
    url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/auth/sso')
  )
}

export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, storage, onSessionExpired, notify, fetchImpl = fetch } = config

  const api = axios.create({
    baseURL: `${baseUrl}/api`,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
    },
  })

  // Token refresh queue management — a burst of requests that all 401 at
  // once should trigger exactly one refresh call, with the rest queued
  // behind it and retried once the new token lands.
  let isRefreshing = false
  let failedQueue: QueuedRequest[] = []

  const processQueue = (error: unknown, token: string | null = null) => {
    failedQueue.forEach((queued) => {
      if (error) {
        queued.reject(error)
      } else {
        queued.resolve(token)
      }
    })
    failedQueue = []
  }

  async function handleSessionExpired(): Promise<void> {
    await storage.clear()
    notify?.('Your session has expired. Please log in again.')
    onSessionExpired()
  }

  // Attach the access token to every outgoing request, except the public
  // auth endpoints.
  api.interceptors.request.use(async (requestConfig) => {
    if (isPublicAuthEndpoint(requestConfig.url || '')) {
      return requestConfig
    }
    const token = await storage.getAccessToken()
    if (token) {
      requestConfig.headers.set('Authorization', `Bearer ${token}`)
    }
    return requestConfig
  })

  // Handle auth errors with automatic token refresh.
  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as RetryableRequestConfig | undefined

      if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
        return Promise.reject(error)
      }

      // Don't attempt refresh for the auth endpoints themselves.
      if (isPublicAuthEndpoint(originalRequest.url || '')) {
        return Promise.reject(error)
      }

      // If already refreshing, queue this request behind it.
      if (isRefreshing) {
        return new Promise<string | null>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          if (token) originalRequest.headers.set('Authorization', `Bearer ${token}`)
          return api(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      const refreshToken = await storage.getRefreshToken()

      if (!refreshToken) {
        processQueue(error, null)
        isRefreshing = false
        await handleSessionExpired()
        return Promise.reject(error)
      }

      try {
        // Use axios directly (not `api`) to avoid re-entering this interceptor.
        const response = await axios.post(
          `${baseUrl}/api/auth/refresh`,
          { refreshToken },
          {
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${refreshToken}`,
            },
          },
        )
        const { accessToken, refreshToken: newRefreshToken } = response.data as {
          accessToken: string
          refreshToken: string
        }

        await storage.setTokens(accessToken, newRefreshToken)
        originalRequest.headers.set('Authorization', `Bearer ${accessToken}`)

        processQueue(null, accessToken)
        isRefreshing = false

        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        isRefreshing = false

        const refreshStatus = (refreshError as { response?: { status?: number } })?.response?.status

        if (!isAuthFailureStatus(refreshStatus)) {
          // Network/offline failure isn't proof the session is invalid; keep
          // tokens and let the caller retry later.
          return Promise.reject(refreshError)
        }

        await handleSessionExpired()
        return Promise.reject(refreshError)
      }
    },
  )

  const coachApi = createCoachApi(api)

  return {
    api,
    auth: createAuthApi(api),
    users: createUsersApi(api),
    goals: createGoalsApi(api),
    notes: createNotesApi(api),
    // Device registration for remote push. Without a row here the whole
    // server-side dispatch pipeline (reminder-dispatch -> Expo channel)
    // runs against an empty subscription set and delivers nothing —
    // see ./push-subscriptions.ts.
    pushSubscriptions: createPushSubscriptionsApi(api),
    tasks: createTasksApi(api),
    schedule: createScheduleApi(api),
    timeEntries: createTimeEntriesApi(api),
    // Cross-device active timer session (dw-time-api PR #72/#73's
    // ActiveTimerSession) — see ./timer-session.ts.
    timerSession: createTimerSessionApi(api),
    categories: createCategoriesApi(api),
    labels: createLabelsApi(api),
    journal: createJournalApi(api),
    // GoalSlot's half of messaging only: mint a service token, open a
    // conversation (which is where the sharing-relationship check lives).
    // Everything else — conversations, messages, read state, live delivery —
    // is the jiffy-messaging service, reached through
    // `createMessagingServiceClient` with the token this mints, because it's
    // a different origin with a different credential and is separately
    // configurable (and frequently not configured at all).
    messaging: createMessagingApi(api),
    sharing: createSharingApi(api),
    // Assign/track instructions a mentor gives a mentee — see ./instructions.ts.
    // Same accepted-share prerequisite as `sharing.getSharedUser*` above,
    // enforced server-side.
    instructions: createInstructionsApi(api),
    // In-app notification history (bell icon / notification-center screen) —
    // the same `Notification` rows every dispatch already writes server-side.
    // See ./notifications.ts.
    notifications: createNotificationsApi(api),
    // Curated community templates (Library): browse, read one in full, import
    // its opt-in sections into the signed-in user's account, and re-sync new
    // tasks from a template already imported. See ./templates.ts.
    templates: createTemplatesApi(api),
    // Namespaced under /coach on the API, but account settings rather than
    // anything the chat screen calls — kept as its own key so the two don't
    // have to grow into one object. See ./coach-settings.ts.
    coachSettings: createCoachSettingsApi(api),
    coach: {
      ...coachApi,
      // Not axios-based (see api/coach.ts's header comment for why) — goes
      // through the injected fetchImpl instead, reusing the same token
      // storage the axios interceptor above reads from so both request
      // paths stay in sync on login/refresh/logout.
      streamChat: (
        scopeKey: string,
        content: string,
        opts?: { signal?: AbortSignal },
      ): Promise<AsyncGenerator<CoachStreamChunk, void, void>> =>
        postCoachStream(
          { baseUrl, fetchImpl, getAccessToken: () => storage.getAccessToken() },
          `/coach/chat/${scopeKey}`,
          { content },
          opts?.signal,
        ),
    },
  }
}
