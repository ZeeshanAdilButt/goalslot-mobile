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

  it('marks everything read in ONE request, scoped', async () => {
    mock.onPatch('/notifications/read-all').reply(200, { updated: 12, scope: 'general', unreadCount: 0 })

    const notifications = createNotificationsApi(api)
    const response = await notifications.markAllRead('general')

    // One request for twelve rows. A loop of per-row PATCHes is the thing this
    // endpoint exists to avoid — the user cannot afford it.
    expect(mock.history.patch).toHaveLength(1)
    expect(mock.history.patch[0]?.url).toBe('/notifications/read-all')
    expect(mock.history.patch[0]?.params).toEqual({ scope: 'general' })
    expect(response.data.updated).toBe(12)
    // Always 0 by construction — the badge is set straight off this, with no
    // follow-up read.
    expect(response.data.unreadCount).toBe(0)
  })

  it('does not send a body with mark-all-read', async () => {
    mock.onPatch('/notifications/read-all').reply(200, { updated: 0, scope: 'all', unreadCount: 0 })

    const notifications = createNotificationsApi(api)
    await notifications.markAllRead('all')

    // The scope is a query param; a body here would be silently ignored by the
    // controller and read as if it were doing something.
    expect(mock.history.patch[0]?.data).toBeUndefined()
  })

  it('deletes one notification by id', async () => {
    mock.onDelete('/notifications/n1').reply(204)

    const notifications = createNotificationsApi(api)
    await notifications.delete('n1')

    expect(mock.history.delete).toHaveLength(1)
    expect(mock.history.delete[0]?.url).toBe('/notifications/n1')
  })
})
