// The cross-device active timer session dw-time-api's PR #72/#73 add
// (`ActiveTimerSession`, one row per user, under `/api/timer/session`).
// Mirrors the response shape ActiveTimerService#toResponse builds
// (dw-time-api/src/modules/active-timer/active-timer.service.ts) and the
// request DTOs in dw-time-api/src/modules/active-timer/dto/active-timer.dto.ts.
//
// Not built from those PRs' generated types because they haven't reached
// dw-time-api's main yet — this is a hand-written mirror kept intentionally
// close to the server shape so it is a small diff to reconcile once the API
// package that DOES ship generated types lands.

import type { TimeEntry } from './time-entry'

export type ActiveTimerSessionStatus = 'RUNNING' | 'PAUSED'

export interface ActiveTimerSessionGoalSummary {
  id: string
  title: string
  color: string
}

export interface ActiveTimerSessionTaskSummary {
  id: string
  title: string
}

export interface ActiveTimerSessionScheduleBlockSummary {
  id: string
  title: string
}

/**
 * GET/POST/PATCH `/timer/session` all return this shape (or `null` from GET
 * when nothing is running). Dates are ISO strings, same as every other
 * timestamp this package already gets back over JSON (see TimeEntry).
 */
export interface ActiveTimerSession {
  id: string
  status: ActiveTimerSessionStatus
  /** When the session was first started. Unaffected by later pause/resume cycles. */
  startedAt: string
  /** When the current RUNNING segment began; null while paused. */
  segmentStartedAt: string | null
  pausedAt: string | null
  /** Elapsed ms banked from segments before the current one. */
  accumulatedMs: number
  /** Server-computed total elapsed ms as of `serverTime` — accumulatedMs plus any open segment. */
  elapsedMs: number
  /** The server's clock at the moment this response was built, paired with `elapsedMs`. */
  serverTime: string
  /** True once `elapsedMs` has passed `maxSessionMs` — the server never auto-stops, it only flags. */
  isStale: boolean
  /** What a stop would actually write — `elapsedMs` clamped to `maxSessionMs`. */
  cappedElapsedMs: number
  maxSessionMs: number
  taskName: string | null
  notes: string | null
  goalId: string | null
  goal: ActiveTimerSessionGoalSummary | null
  taskId: string | null
  task: ActiveTimerSessionTaskSummary | null
  scheduleBlockId: string | null
  scheduleBlock: ActiveTimerSessionScheduleBlockSummary | null
  /** Which client last touched this session — purely informational, for a takeover prompt. */
  lastClient: string | null
  createdAt: string
  updatedAt: string
}

/** Which client is calling, so a 409 takeover prompt elsewhere can name the other device. */
export type ActiveTimerClient = 'web' | 'ios' | 'android' | 'unknown'

/**
 * Attribution fields shared by start/update/stop. `undefined` (an omitted
 * key) means "leave it alone"; an explicit `null` means "clear it" — see
 * dw-time-api's AttributionFieldsDto for the same rule server-side.
 */
export interface ActiveTimerAttributionInput {
  taskName?: string | null
  goalId?: string | null
  taskId?: string | null
  scheduleBlockId?: string | null
  notes?: string | null
}

export interface StartTimerSessionInput extends ActiveTimerAttributionInput {
  /**
   * Replace an existing session instead of failing with 409. The replaced
   * session is DISCARDED, not stopped — callers that want to keep its
   * elapsed time must stop it first.
   */
  takeOver?: boolean
  client?: ActiveTimerClient
}

export type UpdateTimerSessionInput = ActiveTimerAttributionInput & { client?: ActiveTimerClient }
export type StopTimerSessionInput = ActiveTimerAttributionInput & { client?: ActiveTimerClient }

/** Body of the 409 a start() without `takeOver` gets back when a session already exists. */
export interface ActiveTimerConflict {
  code: string
  message: string
  activeSession: ActiveTimerSession | null
}

/**
 * POST /timer/session/stop's response: the TimeEntry it wrote plus the raw
 * numbers, so a caller can tell the user "12h was capped to the 12h max"
 * without re-deriving it.
 */
export interface StopTimerSessionResult {
  timeEntry: TimeEntry
  elapsedMs: number
  durationMinutes: number
  capped: boolean
  maxSessionMs: number
}
