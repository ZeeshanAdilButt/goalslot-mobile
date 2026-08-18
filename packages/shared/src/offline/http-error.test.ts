import { describe, expect, it } from 'vitest'

import { hasResponse, isRetryable } from './http-error'

function withStatus(status: number) {
  return { response: { status } }
}

describe('hasResponse', () => {
  it('is false when the error has no response property', () => {
    expect(hasResponse(new Error('network error'))).toBe(false)
    expect(hasResponse(undefined)).toBe(false)
    expect(hasResponse(null)).toBe(false)
  })

  it('is true whenever a response is present, regardless of status', () => {
    expect(hasResponse(withStatus(500))).toBe(true)
    expect(hasResponse(withStatus(400))).toBe(true)
  })
})

describe('isRetryable', () => {
  it('treats a missing response (offline/timeout) as retryable', () => {
    expect(isRetryable(new Error('network error'))).toBe(true)
    expect(isRetryable(undefined)).toBe(true)
    expect(isRetryable(null)).toBe(true)
  })

  // Transient server/gateway failures — including a reverse proxy returning
  // 502/503/504 mid-deploy — must queue instead of hard-failing.
  it.each([500, 501, 502, 503, 504])('treats a %i response as retryable', (status) => {
    expect(isRetryable(withStatus(status))).toBe(true)
  })

  // Genuine rejections must never be queued — retrying them would just
  // reproduce the same rejection.
  it.each([400, 401, 403, 404, 409, 422])('treats a %i response as not retryable', (status) => {
    expect(isRetryable(withStatus(status))).toBe(false)
  })
})
