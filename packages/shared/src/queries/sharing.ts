// Query-key factory + queryOptions for the sharing directory and a mentee's
// shared data, same factory-around-the-api-group shape as ./goals and
// ./messaging.
//
// Namespaced under 'sharing' rather than folded into 'messaging' (which
// already reads `getMyShares`/`getSharedWithMe` for its own contact list) —
// the two features cache the *same* two directory reads for different
// reasons and at different lifetimes, and giving them one key each keeps an
// invalidation in one feature from silently refetching the other's list too.

import { queryOptions } from '@tanstack/react-query'

import type { SharingApi } from '../api/sharing'

export function createSharingQueries(api: SharingApi) {
  const sharingQueries = {
    all: ['sharing'] as const,
    sharedWithMe: () => [...sharingQueries.all, 'shared-with-me'] as const,
    sharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) =>
      [...sharingQueries.all, 'shared-user', ownerId, 'time-entries', startDate, endDate] as const,
    sharedUserGoals: (ownerId: string) => [...sharingQueries.all, 'shared-user', ownerId, 'goals'] as const,
  }

  return {
    sharingQueries,

    /** People who shared their data with the signed-in user — their mentees. */
    sharedWithMe: () =>
      queryOptions({
        queryKey: sharingQueries.sharedWithMe(),
        queryFn: async () => (await api.getSharedWithMe()).data,
      }),

    sharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) =>
      queryOptions({
        queryKey: sharingQueries.sharedUserTimeEntries(ownerId, startDate, endDate),
        queryFn: async () => (await api.getSharedUserTimeEntries(ownerId, startDate, endDate)).data,
      }),

    sharedUserGoals: (ownerId: string) =>
      queryOptions({
        queryKey: sharingQueries.sharedUserGoals(ownerId),
        queryFn: async () => (await api.getSharedUserGoals(ownerId)).data,
      }),
  }
}

export type SharingQueries = ReturnType<typeof createSharingQueries>
