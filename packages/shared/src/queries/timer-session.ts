// Query key/queryFn factory for the cross-device active timer session, same
// shape as ./time-entries.ts. Polling cadence and focus/foreground
// refetching are call-site concerns (they depend on which screen is
// showing the session), so this only exposes the plain queryOptions —
// apps/mobile/app/(app)/timer.tsx is what layers `refetchInterval` and a
// focus-triggered invalidate on top.

import { queryOptions } from '@tanstack/react-query'

import type { TimerSessionApi } from '../api/timer-session'
import type { ActiveTimerSession } from '../types/active-timer'

export function createTimerSessionQueries(timerSessionApi: TimerSessionApi) {
  const timerSessionQueries = {
    all: ['timer-session'] as const,
    active: () => [...timerSessionQueries.all, 'active'] as const,
  }

  const fetchActive = async (): Promise<ActiveTimerSession | null> => {
    const res = await timerSessionApi.getActive()
    return res.data
  }

  return {
    timerSessionQueries,
    fetchActive,
    active: () =>
      queryOptions({
        queryKey: timerSessionQueries.active(),
        queryFn: fetchActive,
      }),
  }
}
