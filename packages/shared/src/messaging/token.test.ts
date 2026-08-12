import { describe, expect, it, vi } from 'vitest'

import { createMessagingTokenStore } from './token'

describe('createMessagingTokenStore', () => {
  it('mints once and serves the cached token to later callers', async () => {
    const fetchToken = vi.fn().mockResolvedValue({ token: 't1' })
    const store = createMessagingTokenStore({ fetchToken })

    expect(await store.getToken()).toBe('t1')
    expect(await store.getToken()).toBe('t1')
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of concurrent callers into a single mint', async () => {
    const fetchToken = vi.fn().mockResolvedValue({ token: 't1' })
    const store = createMessagingTokenStore({ fetchToken })

    const results = await Promise.all([store.getToken(), store.getToken(), store.getToken()])

    expect(results).toEqual(['t1', 't1', 't1'])
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh mints a new token instead of returning the rejected one', async () => {
    const fetchToken = vi.fn().mockResolvedValueOnce({ token: 't1' }).mockResolvedValueOnce({ token: 't2' })
    const store = createMessagingTokenStore({ fetchToken })

    expect(await store.getToken()).toBe('t1')
    expect(await store.getToken({ forceRefresh: true })).toBe('t2')
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('re-mints once the stated expiry is within the skew window', async () => {
    let clock = 1_000_000
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({ token: 't1', expiresAt: new Date(clock + 60_000).toISOString() })
      .mockResolvedValueOnce({ token: 't2' })

    const store = createMessagingTokenStore({ fetchToken, skewMs: 30_000, now: () => clock })

    expect(await store.getToken()).toBe('t1')
    clock += 20_000 // still 40s of life left, outside the 30s skew
    expect(await store.getToken()).toBe('t1')
    clock += 20_000 // 20s left, inside the skew
    expect(await store.getToken()).toBe('t2')
  })

  it('falls back to the default TTL when the server sends no or an unparseable expiry', async () => {
    let clock = 1_000_000
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({ token: 't1', expiresAt: 'not-a-date' })
      .mockResolvedValueOnce({ token: 't2' })

    const store = createMessagingTokenStore({ fetchToken, defaultTtlMs: 60_000, skewMs: 0, now: () => clock })

    expect(await store.getToken()).toBe('t1')
    clock += 30_000
    expect(await store.getToken()).toBe('t1')
    clock += 31_000
    expect(await store.getToken()).toBe('t2')
  })

  it('does not pin later callers to a rejected mint', async () => {
    const fetchToken = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ token: 't1' })
    const store = createMessagingTokenStore({ fetchToken })

    await expect(store.getToken()).rejects.toThrow('offline')
    expect(await store.getToken()).toBe('t1')
  })

  it('clear() drops the cached token so the next account mints its own', async () => {
    const fetchToken = vi.fn().mockResolvedValueOnce({ token: 't1' }).mockResolvedValueOnce({ token: 't2' })
    const store = createMessagingTokenStore({ fetchToken })

    expect(await store.getToken()).toBe('t1')
    store.clear()
    expect(store.peek()).toBeNull()
    expect(await store.getToken()).toBe('t2')
  })

  it('peek() returns the cached token without minting', async () => {
    const fetchToken = vi.fn().mockResolvedValue({ token: 't1' })
    const store = createMessagingTokenStore({ fetchToken })

    expect(store.peek()).toBeNull()
    await store.getToken()
    expect(store.peek()).toBe('t1')
    expect(fetchToken).toHaveBeenCalledTimes(1)
  })
})
