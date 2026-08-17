// Query-key factory for the notification-center list, same shape as
// ./instructions but cursor-paginated (the API is
// `list({ cursor, limit, scope })` -> `{ items, nextCursor, hasMore,
// unreadCount, scope }`, not a flat array — see ../api/notifications.ts).
//
// Everything for one scope lives under one stable key
// (`['notifications','list',scope]`) rather than one key per cursor:
// `infiniteList()` below hands that single key to `useInfiniteQuery`, which
// merges pages into it itself (`{ pages, pageParams }`), the same way
// react-query's own docs pattern an infinite list.
//
// SCOPE IS PART OF THE KEY, and that is not a nicety. A `nextCursor` minted
// under `scope=general` points at a row in the general-only sequence; feeding
// it back under `scope=all` splices two differently-filtered sequences into
// one list, dropping and repeating rows. Sharing a key between the two scopes
// is exactly how that happens, so `scope` is a required argument here rather
// than an optional one with a default — a call site that forgets it now fails
// to compile instead of quietly reading the wrong feed.

import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import type {
  NotificationListResponse,
  NotificationScope,
  NotificationsApi,
} from '../api/notifications'

const DEFAULT_PAGE_SIZE = 20

export function createNotificationQueries(api: NotificationsApi) {
  const notificationQueries = {
    all: ['notifications'] as const,
    list: (scope: NotificationScope) => [...notificationQueries.all, 'list', scope] as const,
    // Deliberately a DIFFERENT key from `list()` above, not a read off it:
    // `list()` backs a `useInfiniteQuery` and caches an `InfiniteData` page
    // structure, not a flat `NotificationListResponse` — pointing a plain
    // `useQuery` (the bell badge) at the same key would either collide with
    // that shape or fight it for cache ownership. `limit: 1` keeps this a
    // cheap poll (a bell badge only needs the count every response already
    // carries, not the page of items).
    //
    // Scoped for the same reason the list is: the badge and the list a user
    // opens from it must count the same rows, or the bell says "3" over an
    // empty screen.
    unreadCount: (scope: NotificationScope) =>
      [...notificationQueries.all, 'unread-count', scope] as const,
  }

  const fetchPage = async (
    scope: NotificationScope,
    cursor: string | undefined,
  ): Promise<NotificationListResponse> =>
    (await api.list({ cursor, limit: DEFAULT_PAGE_SIZE, scope })).data

  return {
    notificationQueries,

    /** The notification-center screen's list — paged with `fetchNextPage`. */
    infiniteList: (scope: NotificationScope) =>
      infiniteQueryOptions({
        queryKey: notificationQueries.list(scope),
        queryFn: ({ pageParam }) => fetchPage(scope, pageParam),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
      }),

    /** Bell-icon badge count — see `unreadCount()`'s key comment above for why this isn't read off `infiniteList()`. */
    unreadCount: (scope: NotificationScope) =>
      queryOptions({
        queryKey: notificationQueries.unreadCount(scope),
        queryFn: async () => (await api.list({ limit: 1, scope })).data.unreadCount,
      }),
  }
}

export type NotificationQueries = ReturnType<typeof createNotificationQueries>
