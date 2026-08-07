// Ported from dw-time-web/src/lib/utils.ts (minute/time utilities only —
// `cn`, `getProgressColor`, `COLOR_OPTIONS`, `TIME_OPTIONS` are UI-layer
// concerns and stay on web/mobile app code, not this package).

import { toZonedTime } from 'date-fns-tz'

export function timeToMinutes(time: string): number {
  const [hoursStr, minutesStr] = time.split(':')
  const hours = Number(hoursStr)
  const minutes = Number(minutesStr)
  return hours * 60 + minutes
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

/**
 * Convert "HH:mm" (24h) into "h:mm AM/PM". Used in user-facing surfaces;
 * keep storage and APIs in HH:mm.
 */
export function formatTime12h(time: string): string {
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return time
  const ampm = h >= 12 ? 'PM' : 'AM'
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayHour}:${m.toString().padStart(2, '0')} ${ampm}`
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '0m'

  const normalizedMinutes = Math.floor(minutes)
  const hours = Math.floor(normalizedMinutes / 60)
  const mins = normalizedMinutes % 60

  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

/**
 * Get a date as a YYYY-MM-DD string in local (device) time.
 *
 * This intentionally never uses `date.toISOString().split('T')[0]` — that
 * reads the date in UTC, which shows the wrong calendar day for any user
 * behind UTC (e.g. 11pm local on Jan 1 is already Jan 2 in UTC). This was a
 * confirmed bug in the web app's ported call sites; do not reintroduce it.
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Return local time in HH:mm so we can align schedule detection to the user's clock.
export function getLocalTimeString(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Same as getLocalDateString/getLocalTimeString, but for an explicit IANA
 * timezone instead of the device's own zone — e.g. rendering "today" for a
 * schedule that was configured in a different timezone than the device
 * currently sits in.
 */
export function getZonedDateString(date: Date, timezone: string): string {
  return getLocalDateString(toZonedTime(date, timezone))
}

export function getZonedTimeString(date: Date, timezone: string): string {
  return getLocalTimeString(toZonedTime(date, timezone))
}

/**
 * Canonical YYYY-MM-DD "day key" for a date, in local (device) time.
 * Dedupes what used to be five separate `todayKey()` implementations across
 * the web app (components/floating-journal-button.tsx,
 * features/dashboard/hooks/use-daily-checkin.ts,
 * features/journal/components/journal-entry-editor.tsx,
 * features/journal/components/journal-page.tsx,
 * features/journal/components/journal-sidebar.tsx,
 * features/journal/hooks/use-journal-entries.ts) — all of which were
 * hand-rolled duplicates of getLocalDateString.
 */
export function todayKey(date: Date = new Date()): string {
  return getLocalDateString(date)
}

/**
 * ISO-8601 week key, e.g. "2026-W32". Extracted from
 * dw-time-web/src/features/goals/hooks/use-goal-reflection.ts, which had it
 * trapped as a module-local helper.
 */
export function getISOWeekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// Sunday=0 ... Saturday=6, matching Date.getDay() and WeekSchedule's keys.
export const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const DAYS_OF_WEEK_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const
