import { describe, expect, it } from 'vitest'

import {
  formatDuration,
  formatTime12h,
  getISOWeekKey,
  getLocalDateString,
  getLocalTimeString,
  getZonedDateString,
  minutesToTime,
  timeToMinutes,
  todayKey,
} from './time'

describe('timeToMinutes / minutesToTime', () => {
  it('round-trips HH:mm through minutes', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('23:59')).toBe(1439)
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(1439)).toBe('23:59')
  })
})

describe('formatTime12h', () => {
  it('formats midnight, noon, and regular times', () => {
    expect(formatTime12h('00:00')).toBe('12:00 AM')
    expect(formatTime12h('12:00')).toBe('12:00 PM')
    expect(formatTime12h('09:05')).toBe('9:05 AM')
    expect(formatTime12h('21:45')).toBe('9:45 PM')
  })

  it('returns the input unchanged when unparsable', () => {
    expect(formatTime12h('not-a-time')).toBe('not-a-time')
  })
})

describe('formatDuration', () => {
  it('formats minutes into h/m', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(125.9)).toBe('2h 5m')
  })

  it('treats invalid input as 0m', () => {
    expect(formatDuration(-5)).toBe('0m')
    expect(formatDuration(NaN)).toBe('0m')
  })
})

describe('getLocalDateString / getLocalTimeString', () => {
  it('formats without going through toISOString (no UTC off-by-one)', () => {
    // 2026-01-01 23:30 local time must stay Jan 1st, never roll to Jan 2nd
    // the way `date.toISOString().split('T')[0]` would for timezones ahead
    // of UTC when read via UTC.
    const date = new Date(2026, 0, 1, 23, 30, 0)
    expect(getLocalDateString(date)).toBe('2026-01-01')
    expect(getLocalTimeString(date)).toBe('23:30')
  })

  it('pads single-digit months/days/hours/minutes', () => {
    const date = new Date(2026, 2, 5, 4, 7, 0)
    expect(getLocalDateString(date)).toBe('2026-03-05')
    expect(getLocalTimeString(date)).toBe('04:07')
  })
})

describe('getZonedDateString', () => {
  it('formats a date string relative to an explicit timezone, not the device zone', () => {
    // 2026-01-01T02:00:00Z is Dec 31 in New York (UTC-5 in January) even
    // though it's already Jan 1st in UTC.
    const instant = new Date('2026-01-01T02:00:00Z')
    expect(getZonedDateString(instant, 'America/New_York')).toBe('2025-12-31')
    expect(getZonedDateString(instant, 'UTC')).toBe('2026-01-01')
  })
})

describe('todayKey', () => {
  it('is the canonical dedupe of the six duplicated todayKey() implementations and matches getLocalDateString', () => {
    const date = new Date(2026, 5, 15, 8, 0, 0)
    expect(todayKey(date)).toBe(getLocalDateString(date))
    expect(todayKey(date)).toBe('2026-06-15')
  })
})

describe('getISOWeekKey', () => {
  it('computes ISO week numbers correctly, including year boundaries', () => {
    // Jan 1 2025 is a Wednesday, in ISO week 1 of 2025.
    expect(getISOWeekKey(new Date(2025, 0, 1))).toBe('2025-W01')
    // Dec 29 2025 is a Monday, in ISO week 1 of 2026 (ISO weeks can start
    // in the previous Gregorian year).
    expect(getISOWeekKey(new Date(2025, 11, 29))).toBe('2026-W01')
    // Aug 7 2026 (Friday) is ISO week 32.
    expect(getISOWeekKey(new Date(2026, 7, 7))).toBe('2026-W32')
  })
})
