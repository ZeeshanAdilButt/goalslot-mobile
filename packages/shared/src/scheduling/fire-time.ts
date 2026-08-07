// Ported from dw-time-web/src/features/time-tracker/utils/schedule.ts
// (findScheduleBlockForDateTime, findUpcomingScheduleBlocks,
// findNextScheduleBlock, buildLocalDateFromParts) — but NOT a straight port.
//
// The web versions all leaned on the JS Date object's *implicit local
// timezone*: `date.getHours()`, `date.getDay()`, `date.setDate()` etc. all
// read/write in whatever timezone the process happens to be running in. That
// is unsafe for this package for two concrete reasons:
//
//   1. A phone travels across timezones. A background alarm scheduler can't
//      rely on "the device's current local timezone" being the same zone the
//      user's schedule was configured in, or even being stable between when
//      an alarm is scheduled and when it fires.
//   2. Web and mobile must compute the exact same fire time given the same
//      (schedule, timezone) input. That's impossible if either side leans on
//      implicit process-local time, because a web server and a phone are
//      never guaranteed to be running in the same zone.
//
// Every function below therefore takes an explicit IANA timezone string and
// uses date-fns-tz (`toZonedTime` / `fromZonedTime`) to do the conversion,
// so the result is identical no matter what timezone the *runtime* happens
// to be in. See scheduling.test.ts for the DST-transition and
// cross-timezone tests that pin this down.

import { addDays } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

import type { ScheduleBlock, WeekSchedule } from '../types/schedule'
import { timeToMinutes } from './time'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

interface ZonedCalendarParts {
  year: number
  month: number // 0-indexed, matches Date#getMonth
  day: number
  weekday: number // 0 (Sun) - 6 (Sat), matches Date#getDay
  minutesOfDay: number
}

/**
 * Read the wall-clock calendar/time fields that `instant` (an absolute
 * point in time) corresponds to in `timezone`. This is the one place that
 * touches date-fns-tz's zoning trick — everything else in this module goes
 * through it so there's a single spot to reason about correctness.
 */
function zonedCalendarParts(instant: Date, timezone: string): ZonedCalendarParts {
  const zoned = toZonedTime(instant, timezone)
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth(),
    day: zoned.getDate(),
    weekday: zoned.getDay(),
    minutesOfDay: zoned.getHours() * 60 + zoned.getMinutes(),
  }
}

/**
 * Build an absolute UTC instant from a "YYYY-MM-DD" date + "HH:mm" time,
 * interpreted as wall-clock time in `timezone`.
 *
 * Replaces buildLocalDateFromParts, which implicitly used the process's own
 * local timezone (`new Date(year, month, day, hours, minutes)`) — correct
 * only when the process happens to be running in the same zone the
 * schedule was authored in.
 */
export function buildZonedDateFromParts(dateString: string, timeString: string | undefined, timezone: string): Date {
  const [yearStr, monthStr, dayStr] = dateString.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const [hours = 0, minutes = 0] = (timeString || '00:00').split(':').map(Number)
  // A "naive" Date whose local-getter fields hold the desired wall-clock
  // values. fromZonedTime re-interprets those fields as `timezone` wall
  // time and returns the correct absolute UTC instant, regardless of what
  // timezone this process is actually running in.
  const naive = new Date(year || 1970, (month || 1) - 1, day || 1, hours, minutes, 0, 0)
  return fromZonedTime(naive, timezone)
}

/**
 * Find the schedule block active at `now` (an absolute instant), given the
 * schedule was configured for wall-clock times in `timezone`.
 *
 * Replaces findScheduleBlockForDateTime.
 */
export function resolveActiveBlock(
  weekSchedule: WeekSchedule | undefined,
  now: Date,
  timezone: string,
): ScheduleBlock | null {
  if (!weekSchedule) return null
  const { weekday, minutesOfDay } = zonedCalendarParts(now, timezone)
  const blocks = weekSchedule[weekday] || []

  return (
    blocks.find((block) => {
      const start = timeToMinutes(block.startTime)
      const end = timeToMinutes(block.endTime)
      return minutesOfDay >= start && minutesOfDay < end
    }) ?? null
  )
}

export interface UpcomingScheduleBlock {
  block: ScheduleBlock
  /** Absolute UTC instant the block starts, correct across DST in `timezone`. */
  startsAtUtc: Date
}

/**
 * Walk forward from `now` and collect the next `count` upcoming blocks
 * across up to 7 days, given the schedule was configured for wall-clock
 * times in `timezone`.
 *
 * Replaces findUpcomingScheduleBlocks. Calendar-day advancement is done on
 * plain (year, month, day) fields — not by adding 24h*offset to the UTC
 * instant — so it can't drift by an hour across a DST boundary in
 * `timezone` before the day/time fields are re-anchored via
 * buildZonedDateFromParts.
 */
export function findUpcomingScheduleBlocks(
  weekSchedule: WeekSchedule | undefined,
  now: Date,
  timezone: string,
  count: number,
): UpcomingScheduleBlock[] {
  if (!weekSchedule || count <= 0) return []

  const nowParts = zonedCalendarParts(now, timezone)
  const calendarAnchor = new Date(nowParts.year, nowParts.month, nowParts.day)
  const out: UpcomingScheduleBlock[] = []

  for (let offset = 0; offset < 7 && out.length < count; offset++) {
    const weekday = (nowParts.weekday + offset) % 7
    const blocks = (weekSchedule[weekday] || [])
      .slice()
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))

    if (blocks.length === 0) continue

    const targetCalendarDate = addDays(calendarAnchor, offset)
    const dateString = `${targetCalendarDate.getFullYear()}-${pad2(targetCalendarDate.getMonth() + 1)}-${pad2(targetCalendarDate.getDate())}`

    for (const block of blocks) {
      const blockStart = timeToMinutes(block.startTime)
      if (offset === 0 && blockStart <= nowParts.minutesOfDay) continue
      const startsAtUtc = buildZonedDateFromParts(dateString, block.startTime, timezone)
      out.push({ block, startsAtUtc })
      if (out.length >= count) break
    }
  }

  return out
}

/** Replaces findNextScheduleBlock — thin wrapper for callers that want just one. */
export function findNextScheduleBlock(
  weekSchedule: WeekSchedule | undefined,
  now: Date,
  timezone: string,
): UpcomingScheduleBlock | null {
  return findUpcomingScheduleBlocks(weekSchedule, now, timezone, 1)[0] ?? null
}
