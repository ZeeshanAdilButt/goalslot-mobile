// Query key/queryFn factory for the cross-device active timer session, same
// shape as ./time-entries.ts. Polling cadence and focus/foreground
// refetching are call-site concerns (they depend on which screen is
// showing the session), so this only exposes the plain queryOptions —
// apps/mobile/app/(app)/timer.tsx is what layers `refetchInterval` and a
// focus-triggered invalidate on top.

import { queryOptions } from '@tanstack/react-query'

import type { TimerSessionApi } from '../api/timer-session'
import type { ActiveTimerSession } from '../types/active-timer'

/**
 * "Is this actually a session?" — validate the shape rather than testing for
 * null, because the wire never gives us a `null` to test for.
 *
 * `GET /timer/session` answers "nothing is running" by returning `null` from
 * its controller, which Nest sends as a 200 with an EMPTY BODY (its Express
 * adapter's `reply()` calls `response.send()` with no argument for a nil
 * body — verified in dw-time-api's active-timer.controller.ts + Nest's own
 * adapter). Axios surfaces an empty body as the string `''`, not `null`: its
 * default `transformResponse` skips `JSON.parse` for a falsy payload and
 * hands the raw `''` straight through.
 *
 * So `res.data` was `''` — truthy — every time nothing was running, and
 * every caller's `?? null` sailed straight past it. Downstream that reads as
 * a session whose every field is `undefined`: `status !== 'RUNNING'` renders
 * as PAUSED, `accumulatedMs ?? 0` renders 00:00:00, and there is no session
 * behind it to pause, resume or stop — so every transport button errors. The
 * web app hit exactly this and guards it inside its own hook (see
 * goal-slot-web's use-timer.ts); this fixes it once, at the boundary, so the
 * client's "returns null when nothing is running" promise is actually true
 * for every consumer of this factory.
 */
export function toActiveTimerSession(data: unknown): ActiveTimerSession | null {
  if (!data || typeof data !== 'object') return null
  if (typeof (data as ActiveTimerSession).status !== 'string') return null
  return data as ActiveTimerSession
}

export function createTimerSessionQueries(timerSessionApi: TimerSessionApi) {
  const timerSessionQueries = {
    all: ['timer-session'] as const,
    active: () => [...timerSessionQueries.all, 'active'] as const,
  }

  const fetchActive = async (): Promise<ActiveTimerSession | null> => {
    const res = await timerSessionApi.getActive()
    return toActiveTimerSession(res.data)
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
