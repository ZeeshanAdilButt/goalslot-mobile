// Ported from dw-time-web/src/features/schedule/utils/constants.ts and
// dw-time-web/src/features/schedule/utils/utils.ts.
//
// Deliberately excludes PX_PER_MIN / COLUMN_HEIGHT / HOURS — those are web
// drag-grid layout values with no meaning off a DOM canvas (mobile v1 uses a
// day-agenda list, not a 7-day drag grid; see dw-time-mobile/DECISIONS.md #5).

import type { WeekSchedule } from '../types/schedule'
import { timeToMinutes } from './time'

export const DAY_START_MIN = 0
export const DAY_END_MIN = 24 * 60
export const SLOT_MIN = 15
// Allow 15-min blocks (smallest the slot grid supports). Used to be 30 which
// prevented short transitional blocks like a 15-min midday walk from being
// rendered without overlapping the next adjacent block.
export const MIN_DURATION = 15

export function snapMinutes(minutes: number): number {
  const clamped = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, minutes))
  return Math.round(clamped / SLOT_MIN) * SLOT_MIN
}

// `day` is a WeekSchedule key: Sunday=0 ... Saturday=6.
export function hasOverlap(
  weekSchedule: WeekSchedule,
  day: number,
  start: number,
  end: number,
  ignoreId?: string,
): boolean {
  return (weekSchedule[day] || []).some((block) => {
    if (block.id === ignoreId) return false
    const bStart = timeToMinutes(block.startTime)
    const bEnd = timeToMinutes(block.endTime)
    return start < bEnd && end > bStart
  })
}
