// Ported from dw-time-web/src/features/schedule/utils/types.ts

export interface ScheduleBlockGoalSummary {
  id: string
  title: string
  color: string
  category?: string
}

export interface ScheduleBlockTaskSummary {
  id: string
  title: string
  status: string
}

export interface ScheduleBlock {
  id: string
  title: string
  startTime: string
  endTime: string
  dayOfWeek: number
  category: string
  color: string
  isRecurring: boolean
  isPrivate: boolean
  seriesId: string
  goalId?: string
  goal?: ScheduleBlockGoalSummary
  tasks?: ScheduleBlockTaskSummary[]
}

/**
 * Keyed by JS `Date.getDay()` convention: 0 = Sunday ... 6 = Saturday.
 *
 * IMPORTANT: every function in `src/scheduling` that reads or writes a
 * `WeekSchedule` uses this same Sunday=0 indexing. Monday-start week
 * indexing (`weekStartsOn: 1`) is used ONLY by the reporting/analytics
 * date-range helpers (`src/scheduling/reporting.ts`), which don't touch
 * `WeekSchedule` at all. The web app mixed the two conventions in a few
 * places; this package keeps them in separate modules so callers can't
 * accidentally cross the streams.
 */
export type WeekSchedule = Record<number, ScheduleBlock[]>

export type SchedulePayload = {
  title: string
  startTime: string
  endTime: string
  dayOfWeek: number
  category: string
  color: string
  goalId?: string
  seriesId?: string
  isPrivate?: boolean
}

export type ScheduleUpdateScope = 'single' | 'series'

/**
 * How far a delete reaches. Mirrors `ScheduleUpdateScope`, but note the
 * asymmetry in how each is honoured: the API accepts `updateScope` in the
 * PUT body and fans out server-side (`updateMany({ userId, seriesId })`),
 * whereas `DELETE /schedule/:id` takes no scope at all. There is no
 * `deleteScope` field on the wire — a 'series' delete is the CLIENT issuing
 * one DELETE per member block. This type names the user's intent so the UI
 * and the call site agree on it; it is never serialised.
 */
export type ScheduleDeleteScope = 'single' | 'series'

export type ScheduleUpdatePayload = Partial<Omit<SchedulePayload, 'seriesId'>> & {
  updateScope?: ScheduleUpdateScope
}

export type DraftSelection = {
  dayOfWeek: number
  start: number
  end: number
}
