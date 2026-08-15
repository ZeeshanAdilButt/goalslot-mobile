import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMessagingApi, createMessagingServiceClient, MessagingError, toMessagingError } from './messaging'

const mock = new MockAdapter(axios)
const BASE_URL = 'https://messaging.test'

afterEach(() => {
  mock.reset()
})

describe('createMessagingApi', () => {
  it('mints a token and opens a conversation against GoalSlot, not the messaging service', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const apiMock = new MockAdapter(api)
    apiMock.onPost('/messaging/token').reply(200, { token: 'jwt' })
    // Real shape per goal-slot-api's OpenConversationResponse: keyed
    // `conversationId`, not `id` — that field belongs to jiffy-messaging's
    // own conversation object, which this endpoint does not return as-is.
    apiMock.onPost('/messaging/conversations').reply(201, {
      conversationId: 'c1',
      participantIds: ['u1', 'u2'],
      createdAt: '2026-08-15T00:00:00.000Z',
      created: true,
      counterpart: { id: 'u2', name: 'Mentee', email: 'mentee@test.com', avatar: null },
    })

    const messaging = createMessagingApi(api)

    expect((await messaging.issueToken()).data.token).toBe('jwt')
    expect((await messaging.createConversation({ userId: 'u2' })).data.conversationId).toBe('c1')
    expect(apiMock.history.post[1]?.data).toBe(JSON.stringify({ userId: 'u2' }))
  })
})

describe('toMessagingError', () => {
  it('maps every documented status to a distinct kind', () => {
    const kindFor = (status?: number) => toMessagingError({ response: status === undefined ? undefined : { status } }).kind

    expect(kindFor(400)).toBe('bad-request')
    expect(kindFor(401)).toBe('unauthorized')
    expect(kindFor(403)).toBe('forbidden')
    expect(kindFor(404)).toBe('not-found')
    expect(kindFor(429)).toBe('rate-limited')
    expect(kindFor(500)).toBe('server')
    expect(kindFor(418)).toBe('unknown')
    // No response at all is a network failure, not a server error.
    expect(kindFor(undefined)).toBe('network')
  })

  it('passes a MessagingError through unchanged', () => {
    const original = new MessagingError('forbidden', 'nope', 403)
    expect(toMessagingError(original)).toBe(original)
  })
})

describe('createMessagingServiceClient', () => {
  function client(options: { getToken?: ReturnType<typeof vi.fn>; baseUrl?: string } = {}) {
    // `baseUrl` absent means "not configured" — hence an options object
    // rather than a defaulted positional, which can't tell an explicit
    // `undefined` from an omitted argument.
    const getToken = options.getToken ?? vi.fn().mockResolvedValue('jwt')
    return {
      instance: createMessagingServiceClient({ getBaseUrl: () => options.baseUrl, getToken }),
      getToken,
    }
  }

  it('rejects with kind not-configured — never a bogus request — when no URL is set', async () => {
    const { instance, getToken } = client({ getToken: vi.fn() })

    await expect(instance.listConversations()).rejects.toMatchObject({ kind: 'not-configured' })
    expect(getToken).not.toHaveBeenCalled()
  })

  it('sends the bearer token and returns the body', async () => {
    const { instance } = client({ baseUrl: BASE_URL })
    mock.onGet('https://messaging.test/conversations').reply(200, [{ id: 'c1', participants: [] }])

    await expect(instance.listConversations()).resolves.toEqual([{ id: 'c1', participants: [] }])
    expect(mock.history.get[0]?.headers?.Authorization).toBe('Bearer jwt')
  })

  it('sends the documented paging params for history', async () => {
    const { instance } = client({ baseUrl: BASE_URL })
    mock.onGet('https://messaging.test/conversations/c1/messages').reply(200, [])

    await instance.listMessages('c1', { limit: 25, before: '2026-08-12T10:00:00.000Z' })

    expect(mock.history.get[0]?.params).toEqual({ limit: 25, before: '2026-08-12T10:00:00.000Z' })
  })

  it('omits `before` on the first page rather than sending undefined', async () => {
    const { instance } = client({ baseUrl: BASE_URL })
    mock.onGet('https://messaging.test/conversations/c1/messages').reply(200, [])

    await instance.listMessages('c1')

    expect(mock.history.get[0]?.params).toEqual({ limit: 50 })
  })

  it('retries a 401 exactly once with a force-refreshed token', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')
    const { instance } = client({ getToken, baseUrl: BASE_URL })

    mock
      .onPost('https://messaging.test/conversations/c1/messages')
      .replyOnce(401)
      .onPost('https://messaging.test/conversations/c1/messages')
      .replyOnce(201, { id: 'm1' })

    await expect(instance.sendMessage('c1', 'hi')).resolves.toEqual({ id: 'm1' })

    expect(getToken).toHaveBeenNthCalledWith(1, { forceRefresh: false })
    expect(getToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
  })

  it('gives up after one failed retry instead of spinning on a dead token', async () => {
    const getToken = vi.fn().mockResolvedValue('stale')
    const { instance } = client({ getToken, baseUrl: BASE_URL })
    mock.onGet('https://messaging.test/conversations').reply(401)

    await expect(instance.listConversations()).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(getToken).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 403 — not-a-participant is an answer, not a stale credential', async () => {
    const getToken = vi.fn().mockResolvedValue('jwt')
    const { instance } = client({ getToken, baseUrl: BASE_URL })
    mock.onGet('https://messaging.test/conversations/c1').reply(403)

    await expect(instance.getConversation('c1')).rejects.toMatchObject({ kind: 'forbidden' })
    expect(getToken).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failure to mint the token as a MessagingError', async () => {
    const getToken = vi.fn().mockRejectedValue({ response: { status: 401 } })
    const { instance } = client({ getToken, baseUrl: BASE_URL })

    await expect(instance.listConversations()).rejects.toBeInstanceOf(MessagingError)
  })

  it('marks a thread read without needing a response body', async () => {
    const { instance } = client({ baseUrl: BASE_URL })
    mock.onPost('https://messaging.test/conversations/c1/read').reply(204)

    await expect(instance.markRead('c1')).resolves.toBeUndefined()
  })

  it('tolerates a base URL with a trailing slash', async () => {
    const { instance } = client({ baseUrl: `${BASE_URL}/` })
    mock.onGet('https://messaging.test/conversations').reply(200, [])

    await expect(instance.listConversations()).resolves.toEqual([])
  })
})
