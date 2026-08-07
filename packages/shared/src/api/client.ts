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

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import type { ApiClientConfig } from './types'
import { createAuthApi } from './auth'
import { createCategoriesApi } from './categories'
import { createGoalsApi } from './goals'
import { createLabelsApi } from './labels'
import { createScheduleApi } from './schedule'
import { createTasksApi } from './tasks'
import { createTimeEntriesApi } from './time-entries'

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

interface QueuedRequest {
  resolve: (token: string | null) => void
  reject: (error: unknown) => void
}

function isAuthFailureStatus(status: number | undefined): boolean {
  return status === 401 || status === 403
}

export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, storage, onSessionExpired, notify } = config

  const api = axios.create({
    baseURL: `${baseUrl}/api`,
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

  // Attach the access token to every outgoing request.
  api.interceptors.request.use(async (requestConfig) => {
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

      const requestUrl = originalRequest.url || ''
      const isRefreshEndpoint = requestUrl.includes('/auth/refresh')
      const isLoginEndpoint = requestUrl.includes('/auth/login')
      const isRegisterEndpoint = requestUrl.includes('/auth/register')
      const isSSOEndpoint = requestUrl.includes('/auth/sso')

      // Don't attempt refresh for the auth endpoints themselves.
      if (isRefreshEndpoint || isLoginEndpoint || isRegisterEndpoint || isSSOEndpoint) {
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

  return {
    api,
    auth: createAuthApi(api),
    goals: createGoalsApi(api),
    tasks: createTasksApi(api),
    schedule: createScheduleApi(api),
    timeEntries: createTimeEntriesApi(api),
    categories: createCategoriesApi(api),
    labels: createLabelsApi(api),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
export type { AxiosInstance }
