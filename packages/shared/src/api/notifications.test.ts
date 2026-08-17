import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it } from 'vitest'

import { createNotificationsApi } from './notifications'

const api = axios.create({ baseURL: 'https://api.test/api' })
const mock = new MockAdapter(api)

afterEach(() => {
  mock.reset()
})

describe('createNotificationsApi', () => {
  it('sends the scope to the list endpoint alongside cursor and limit', async () => {
    mock.onGet('/notifications').reply(200, { items: [], nextCursor: null, hasMore: false, unreadCount: 0 })

    const notifications = createNotificationsApi(api)
    await notifications.list({ cursor: 'n7', limit: 20, scope: 'general' })

    // Read off the request rather than trusting the argument object: `scope`
    // has to reach the wire as a query param, because the server applies it to
    // `unreadCount` as well as `items` and no amount of client filtering can
    // reproduce that.
    expect(mock.history.get[0]?.params).toEqual({ cursor: 'n7', limit: 20, scope: 'general' })
  })

  it('marks one notification read by id', async () => {
    mock.onPatch('/notifications/n1/read').reply(200, { id: 'n1', readAt: '2026-08-17T09:00:00.000Z' })

    const notifications = createNotificationsApi(api)
    expect((await notifications.markRead('n1')).data.readAt).toBe('2026-08-17T09:00:00.000Z')
  })
})
