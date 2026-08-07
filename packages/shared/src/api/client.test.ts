import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TokenStorage } from './types'
import { createApiClient } from './client'

const BASE_URL = 'https://api.test'

function createMemoryStorage(initial?: { access?: string; refresh?: string }): TokenStorage {
  let access = initial?.access ?? null
  let refresh = initial?.refresh ?? null
  return {
    getAccessToken: async () => access,
    getRefreshToken: async () => refresh,
    setTokens: async (a, r) => {
      access = a
      refresh = r
    },
    clear: async () => {
      access = null
      refresh = null
    },
  }
}

// client.ts deliberately issues the token-refresh POST via the raw `axios`
// import rather than the per-client `api` instance, to avoid re-entering its
// own response interceptor (see the comment in client.ts). A MockAdapter
// attached to `client.api` can't see that call, so refresh-flow tests mock
// it on the shared top-level `axios` object instead, by full URL (the raw
// call has no baseURL configured).
let rawAxiosMock: MockAdapter | undefined

afterEach(() => {
  rawAxiosMock?.restore()
  rawAxiosMock = undefined
})

function mockRefreshEndpoint(): MockAdapter {
  rawAxiosMock = new MockAdapter(axios)
  return rawAxiosMock
}

describe('createApiClient', () => {
  it('attaches the stored access token to outgoing requests', async () => {
    const storage = createMemoryStorage({ access: 'token-123', refresh: 'refresh-123' })
    const onSessionExpired = vi.fn()
    const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired })
    const mock = new MockAdapter(client.api)

    mock.onGet('/goals').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer token-123')
      return [200, []]
    })

    await client.goals.getAll()
    expect(mock.history.get).toHaveLength(1)
  })

  it('does not attach a header when there is no stored token', async () => {
    const storage = createMemoryStorage()
    const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired: vi.fn() })
    const mock = new MockAdapter(client.api)

    mock.onGet('/goals').reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined()
      return [200, []]
    })

    await client.goals.getAll()
  })

  describe('401 refresh flow', () => {
    it('refreshes the token once and retries the original request', async () => {
      const storage = createMemoryStorage({ access: 'expired-token', refresh: 'valid-refresh' })
      const onSessionExpired = vi.fn()
      const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired })
      const mock = new MockAdapter(client.api)
      const refreshMock = mockRefreshEndpoint()

      let goalsCallCount = 0
      mock.onGet('/goals').reply((config) => {
        goalsCallCount++
        if (config.headers?.Authorization === 'Bearer expired-token') {
          return [401, { message: 'Unauthorized' }]
        }
        expect(config.headers?.Authorization).toBe('Bearer fresh-token')
        return [200, [{ id: 'g1' }]]
      })

      refreshMock.onPost(`${BASE_URL}/api/auth/refresh`).reply(200, {
        accessToken: 'fresh-token',
        refreshToken: 'fresh-refresh',
      })

      const res = await client.goals.getAll()

      expect(res.data).toEqual([{ id: 'g1' }])
      expect(goalsCallCount).toBe(2)
      expect(await storage.getAccessToken()).toBe('fresh-token')
      expect(await storage.getRefreshToken()).toBe('fresh-refresh')
      expect(onSessionExpired).not.toHaveBeenCalled()
    })

    it('clears storage and calls onSessionExpired when there is no refresh token', async () => {
      const storage = createMemoryStorage({ access: 'expired-token' }) // no refresh token
      const onSessionExpired = vi.fn()
      const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired })
      const mock = new MockAdapter(client.api)

      mock.onGet('/goals').reply(401, { message: 'Unauthorized' })

      await expect(client.goals.getAll()).rejects.toBeTruthy()
      expect(onSessionExpired).toHaveBeenCalledTimes(1)
      expect(await storage.getAccessToken()).toBeNull()
    })

    it('clears storage and calls onSessionExpired when the refresh request itself 401s', async () => {
      const storage = createMemoryStorage({ access: 'expired-token', refresh: 'stale-refresh' })
      const onSessionExpired = vi.fn()
      const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired })
      const mock = new MockAdapter(client.api)
      const refreshMock = mockRefreshEndpoint()

      mock.onGet('/goals').reply(401, { message: 'Unauthorized' })
      refreshMock.onPost(`${BASE_URL}/api/auth/refresh`).reply(401, { message: 'Invalid refresh token' })

      await expect(client.goals.getAll()).rejects.toBeTruthy()
      expect(onSessionExpired).toHaveBeenCalledTimes(1)
      expect(await storage.getAccessToken()).toBeNull()
      expect(await storage.getRefreshToken()).toBeNull()
    })

    it('does not attempt a refresh for the login endpoint itself', async () => {
      const storage = createMemoryStorage()
      const onSessionExpired = vi.fn()
      const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired })
      const mock = new MockAdapter(client.api)
      const refreshMock = mockRefreshEndpoint()

      mock.onPost('/auth/login').reply(401, { message: 'Invalid credentials' })

      await expect(client.auth.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeTruthy()
      expect(refreshMock.history.post).toHaveLength(0)
      expect(onSessionExpired).not.toHaveBeenCalled()
    })

    it('queues concurrent requests behind a single in-flight refresh', async () => {
      const storage = createMemoryStorage({ access: 'expired-token', refresh: 'valid-refresh' })
      const client = createApiClient({ baseUrl: BASE_URL, storage, onSessionExpired: vi.fn() })
      const mock = new MockAdapter(client.api)
      const refreshMock = mockRefreshEndpoint()

      let refreshCallCount = 0
      refreshMock.onPost(`${BASE_URL}/api/auth/refresh`).reply(() => {
        refreshCallCount++
        return [200, { accessToken: 'fresh-token', refreshToken: 'fresh-refresh' }]
      })
      mock.onGet('/goals').reply((config) =>
        config.headers?.Authorization === 'Bearer fresh-token' ? [200, []] : [401, {}],
      )
      mock.onGet('/tasks').reply((config) =>
        config.headers?.Authorization === 'Bearer fresh-token' ? [200, []] : [401, {}],
      )

      await Promise.all([client.goals.getAll(), client.tasks.list()])

      expect(refreshCallCount).toBe(1)
    })
  })
})
