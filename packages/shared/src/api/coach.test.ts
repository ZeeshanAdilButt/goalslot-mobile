import { describe, expect, it, vi } from 'vitest'

import type { AxiosInstance } from 'axios'

import { createCoachApi, currentCoachWeekScopeKey, parseCoachSseStream, postCoachStream } from './coach'

/** Build a Response whose body streams the given chunks, framed as SSE. */
function sseResponse(frames: string[], init?: { ok?: boolean; status?: number }): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  })
  return new Response(body, { status: init?.status ?? 200 })
}

describe('parseCoachSseStream', () => {
  it('parses complete data: frames separated by a blank line', async () => {
    const res = sseResponse([
      'data: {"delta":"Hel","done":false}\n\n',
      'data: {"delta":"lo","done":false}\n\n',
      'data: {"delta":"","done":true}\n\n',
    ])
    const chunks = []
    for await (const chunk of parseCoachSseStream(res)) chunks.push(chunk)
    expect(chunks).toEqual([
      { delta: 'Hel', done: false },
      { delta: 'lo', done: false },
      { delta: '', done: true },
    ])
  })

  it('reassembles a frame split across multiple stream chunks', async () => {
    const res = sseResponse(['data: {"delta":"Hel', 'lo world","done":true}\n\n'])
    const chunks = []
    for await (const chunk of parseCoachSseStream(res)) chunks.push(chunk)
    expect(chunks).toEqual([{ delta: 'Hello world', done: true }])
  })

  it('tolerates \\r\\n line endings', async () => {
    const res = sseResponse(['data: {"delta":"hi","done":true}\r\n\r\n'])
    const chunks = []
    for await (const chunk of parseCoachSseStream(res)) chunks.push(chunk)
    expect(chunks).toEqual([{ delta: 'hi', done: true }])
  })

  it('unwraps a NestJS @Sse() { data: ... } envelope', async () => {
    const res = sseResponse(['data: {"data":{"delta":"wrapped","done":true}}\n\n'])
    const chunks = []
    for await (const chunk of parseCoachSseStream(res)) chunks.push(chunk)
    expect(chunks).toEqual([{ delta: 'wrapped', done: true }])
  })

  it('drops a malformed frame instead of throwing', async () => {
    const res = sseResponse(['data: {not json}\n\n', 'data: {"delta":"ok","done":true}\n\n'])
    const chunks = []
    for await (const chunk of parseCoachSseStream(res)) chunks.push(chunk)
    expect(chunks).toEqual([{ delta: 'ok', done: true }])
  })

  it('stops cleanly when the signal is already aborted', async () => {
    const res = sseResponse(['data: {"delta":"hi","done":true}\n\n'])
    const controller = new AbortController()
    controller.abort()
    const chunks = []
    for await (const chunk of parseCoachSseStream(res, controller.signal)) chunks.push(chunk)
    expect(chunks).toEqual([])
  })

  it('throws when the response has no body', async () => {
    const res = new Response(null, { status: 200 })
    await expect(async () => {
      for await (const _ of parseCoachSseStream(res)) {
        /* noop */
      }
    }).rejects.toThrow('Response has no body to stream')
  })
})

describe('postCoachStream', () => {
  it('attaches the bearer token and streams the parsed deltas', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(['data: {"delta":"hi","done":true}\n\n']))
    const iter = await postCoachStream(
      { baseUrl: 'https://api.test', fetchImpl, getAccessToken: async () => 'token-abc' },
      '/coach/chat/2026-W32',
      { content: 'hello' },
    )
    const chunks = []
    for await (const chunk of iter) chunks.push(chunk)
    expect(chunks).toEqual([{ delta: 'hi', done: true }])

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/api/coach/chat/2026-W32',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
        body: JSON.stringify({ content: 'hello' }),
      }),
    )
  })

  it('omits the Authorization header when there is no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(['data: {"delta":"hi","done":true}\n\n']))
    await postCoachStream(
      { baseUrl: 'https://api.test', fetchImpl, getAccessToken: async () => null },
      '/coach/chat/2026-W32',
      { content: 'hello' },
    )
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('throws with the server message on a non-ok response (e.g. rate limit)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(
      postCoachStream(
        { baseUrl: 'https://api.test', fetchImpl, getAccessToken: async () => 'token' },
        '/coach/chat/2026-W32',
        { content: 'hello' },
      ),
    ).rejects.toThrow('Too many requests')
  })
})

describe('currentCoachWeekScopeKey', () => {
  it('formats an ISO week as YYYY-Www', () => {
    // 2026-08-08 is a Saturday in ISO week 32.
    expect(currentCoachWeekScopeKey(new Date(Date.UTC(2026, 7, 8)))).toBe('2026-W32')
  })

  it('rolls a Jan 1st Thursday into week 01', () => {
    // 2026-01-01 is a Thursday, so ISO week 1 of 2026.
    expect(currentCoachWeekScopeKey(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-W01')
  })
})

describe('createCoachApi', () => {
  it('normalizes the { messages } envelope to a plain array', async () => {
    const get = vi.fn().mockResolvedValue({ data: { messages: [{ id: 'm1' }] } })
    const api = { get } as unknown as AxiosInstance
    const coachApi = createCoachApi(api)

    const res = await coachApi.getChatHistory('2026-W32')
    expect(get).toHaveBeenCalledWith('/coach/chat/2026-W32')
    expect(res.data).toEqual([{ id: 'm1' }])
  })

  it('tolerates a bare array response too', async () => {
    const get = vi.fn().mockResolvedValue({ data: [{ id: 'm1' }] })
    const api = { get } as unknown as AxiosInstance
    const coachApi = createCoachApi(api)

    const res = await coachApi.getChatHistory('2026-W32')
    expect(res.data).toEqual([{ id: 'm1' }])
  })

  it('defaults to an empty array when there is no conversation yet', async () => {
    const get = vi.fn().mockResolvedValue({ data: { messages: [] } })
    const api = { get } as unknown as AxiosInstance
    const coachApi = createCoachApi(api)

    const res = await coachApi.getChatHistory('2026-W32')
    expect(res.data).toEqual([])
  })
})
