// Client for dw-time-api's cross-device active timer session
// (`/timer/session`, PR #72/#73 — see ../types/active-timer.ts's header for
// why this is hand-written rather than generated). Singular resource: a
// user has at most one active session, so there is no id in any of these
// paths and every call is implicitly scoped to the caller by their token.

import type { AxiosInstance } from 'axios'

import type {
  ActiveTimerSession,
  StartTimerSessionInput,
  StopTimerSessionInput,
  StopTimerSessionResult,
  UpdateTimerSessionInput,
} from '../types/active-timer'

export function createTimerSessionApi(api: AxiosInstance) {
  return {
    /** Returns `null` (200), not a 404, when nothing is running — callers need no error handling to poll this. */
    getActive: () => api.get<ActiveTimerSession | null>('/timer/session'),
    /** 409s (with the current session in the body) unless `takeOver: true` — see ActiveTimerConflict. */
    start: (data: StartTimerSessionInput = {}) => api.post<ActiveTimerSession>('/timer/session', data),
    pause: () => api.post<ActiveTimerSession>('/timer/session/pause'),
    resume: () => api.post<ActiveTimerSession>('/timer/session/resume'),
    /** Attach/detach attribution mid-session. Omitted fields are left alone; `null` clears them. */
    update: (data: UpdateTimerSessionInput) => api.patch<ActiveTimerSession>('/timer/session', data),
    /** Converts the session into a TimeEntry, atomically, and clears it. */
    stop: (data: StopTimerSessionInput = {}) => api.post<StopTimerSessionResult>('/timer/session/stop', data),
    /** Abandons the session with no TimeEntry written — for an accidental start. */
    discard: () => api.delete<{ discarded: boolean }>('/timer/session'),
  }
}

export type TimerSessionApi = ReturnType<typeof createTimerSessionApi>
