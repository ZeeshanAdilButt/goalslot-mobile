// The hazard these tests pin: `scope` must be part of the query key, and the
// scope a key is built from must be the scope its queryFn actually requests.
//
// A `nextCursor` minted under `scope=general` addresses a row in the
// general-only sequence. Share one cache key between the two scopes and
// react-query will happily hand a general cursor to an 'all' fetch (or the
// reverse), splicing two differently-filtered sequences into one list —
// rows dropped, rows repeated, and an `unreadCount` that belongs to neither.

import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it } from 'vitest'

import { createNotificationsApi } from '../api/notifications'
import { createNotificationQueries } from './notifications'

const api = axios.create({ baseURL: 'https://api.test/api' })
const mock = new MockAdapter(api)
const queries = createNotificationQueries(createNotificationsApi(api))

afterEach(() => {
  mock.reset()
})

describe('notification query keys', () => {
  it('puts the scope in the list key', () => {
    expect(queries.notificationQueries.list('general')).toEqual(['notifications', 'list', 'general'])
    expect(queries.notificationQueries.list('all')).toEqual(['notifications', 'list', 'all'])
  })

  it('puts the scope in the unread-count key', () => {
    expect(queries.notificationQueries.unreadCount('general')).toEqual([
      'notifications',
      'unread-count',
      'general',
    ])
  })

  it('never shares a cache key between the two scopes', () => {
    // The single assertion that makes cursor-splicing impossible.
    expect(queries.notificationQueries.list('general')).not.toEqual(queries.notificationQueries.list('all'))
    expect(queries.notificationQueries.unreadCount('general')).not.toEqual(
      queries.notificationQueries.unreadCount('all'),
    )
  })

  it('keeps the list and its badge under different keys within one scope', () => {
    // `list` caches react-query's `InfiniteData` page structure; the badge
    // caches a bare number. Same key would mean one shape overwriting the
    // other.
    expect(queries.notificationQueries.list('general')).not.toEqual(
      queries.notificationQueries.unreadCount('general'),
    )
  })
})

describe('infiniteList', () => {
  it('keys and fetches under the same scope', async () => {
    mock.onGet('/notifications').reply(200, { items: [], nextCursor: null, hasMore: false, unreadCount: 0 })

    const options = queries.infiniteList('general')
    expect(options.queryKey).toEqual(['notifications', 'list', 'general'])

    // The key says 'general'; prove the request does too. A key/request
    // mismatch is precisely the bug that would cache one feed under the
    // other's name.
    // `{} as never` is this suite's established way of invoking a queryFn
    // outside a QueryClient — see queries.test.ts.
    await options.queryFn?.({ pageParam: undefined } as never)
    expect(mock.history.get[0]?.params).toMatchObject({ scope: 'general' })
  })

  it('threads the cursor through unchanged, still scoped', async () => {
    mock.onGet('/notifications').reply(200, { items: [], nextCursor: null, hasMore: false, unreadCount: 0 })

    const options = queries.infiniteList('all')
    await options.queryFn?.({ pageParam: 'cursor-42' } as never)

    expect(mock.history.get[0]?.params).toMatchObject({ cursor: 'cursor-42', scope: 'all' })
  })

  it('stops paging when the server says there is no more, even if a cursor is present', () => {
    const options = queries.infiniteList('general')
    // Guards against paging forever off a stale cursor: `hasMore` is the
    // authority, not the presence of `nextCursor`.
    expect(
      options.getNextPageParam({ items: [], nextCursor: 'n9', hasMore: false, unreadCount: 3 }, [], undefined, []),
    ).toBeUndefined()
    expect(
      options.getNextPageParam({ items: [], nextCursor: 'n9', hasMore: true, unreadCount: 3 }, [], undefined, []),
    ).toBe('n9')
  })
})

describe('unreadCount', () => {
  it('asks for the count in the requested scope, not the whole table', async () => {
    mock.onGet('/notifications').reply(200, { items: [], nextCursor: null, hasMore: false, unreadCount: 4 })

    const options = queries.unreadCount('general')
    const count = await options.queryFn?.({} as never)

    expect(count).toBe(4)
    // limit: 1 keeps this cheap — the badge only needs the number every
    // response already carries, not a page of rows.
    expect(mock.history.get[0]?.params).toEqual({ limit: 1, scope: 'general' })
  })
})
