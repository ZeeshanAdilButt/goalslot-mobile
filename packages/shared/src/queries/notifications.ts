// Query-key factory for the notification-center list, same shape as
// ./instructions but cursor-paginated (the API is `list({ cursor, limit })`
// -> `{ items, nextCursor, hasMore, unreadCount }`, not a flat array — see
// ../api/notifications.ts).
//
// Everything lives under one stable key (`['notifications','list']`) rather
// than one key per cursor: `infiniteList()` below hands that single key to
// `useInfiniteQuery`, which merges pages into it itself
// (`{ pages, pageParams }`), the same way react-query's own docs pattern an
// infinite list. A `markRead` mutation elsewhere just needs this one key to
// invalidate, regardless of how many pages the user has scrolled through.

import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import type { NotificationListResponse, NotificationsApi } from '../api/notifications'

const DEFAULT_PAGE_SIZE = 20

export function createNotificationQueries(api: NotificationsApi) {
  const notificationQueries = {
    all: ['notifications'] as const,
    list: () => [...notificationQueries.all, 'list'] as const,
    // Deliberately a DIFFERENT key from `list()` above, not a read off it:
    // `list()` backs a `useInfiniteQuery` and caches an `InfiniteData` page
    // structure, not a flat `NotificationListResponse` — pointing a plain
    // `useQuery` (the bell badge) at the same key would either collide with
    // that shape or fight it for cache ownership. `limit: 1` keeps this a
    // cheap poll (a bell badge only needs the count every response already
    // carries, not the page of items).
    unreadCount: () => [...notificationQueries.all, 'unread-count'] as const,
  }

  const fetchPage = async (cursor: string | undefined): Promise<NotificationListResponse> =>
    (await api.list({ cursor, limit: DEFAULT_PAGE_SIZE })).data

  return {
    notificationQueries,

    /** The notification-center screen's list — paged with `fetchNextPage`. */
    infiniteList: () =>
      infiniteQueryOptions({
        queryKey: notificationQueries.list(),
        queryFn: ({ pageParam }) => fetchPage(pageParam),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined),
      }),

    /** Bell-icon badge count — see `unreadCount()`'s key comment above for why this isn't read off `infiniteList()`. */
    unreadCount: () =>
      queryOptions({
        queryKey: notificationQueries.unreadCount(),
        queryFn: async () => (await api.list({ limit: 1 })).data.unreadCount,
      }),
  }
}

export type NotificationQueries = ReturnType<typeof createNotificationQueries>
