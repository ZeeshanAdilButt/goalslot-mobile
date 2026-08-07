import { describe, expect, it } from 'vitest'

import type { ScheduleBlock, WeekSchedule } from '../types/schedule'
import { buildZonedDateFromParts, findNextScheduleBlock, findUpcomingScheduleBlocks, resolveActiveBlock } from './fire-time'

function block(overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, 'id' | 'startTime' | 'endTime' | 'dayOfWeek'>): ScheduleBlock {
  return {
    title: 'Block',
    category: 'WORK',
    color: '#000000',
    isRecurring: true,
    isPrivate: false,
    seriesId: 'series-1',
    ...overrides,
  }
}

describe('resolveActiveBlock', () => {
  it('resolves the block active at a given instant in the configured timezone', () => {
    // Friday Aug 7 2026, 10:30 America/New_York (EDT, UTC-4) => 14:30 UTC.
    const schedule: WeekSchedule = {
      5: [block({ id: 'b1', startTime: '09:00', endTime: '12:00', dayOfWeek: 5 })],
    }
    const now = new Date('2026-08-07T14:30:00Z')
    const result = resolveActiveBlock(schedule, now, 'America/New_York')
    expect(result?.id).toBe('b1')
  })

  it('returns null when the instant falls outside every block that day', () => {
    const schedule: WeekSchedule = {
      5: [block({ id: 'b1', startTime: '09:00', endTime: '12:00', dayOfWeek: 5 })],
    }
    // 13:30 EDT on the same Friday — after the block ends.
    const now = new Date('2026-08-07T17:30:00Z')
    expect(resolveActiveBlock(schedule, now, 'America/New_York')).toBeNull()
  })

  it('returns null for an undefined schedule', () => {
    expect(resolveActiveBlock(undefined, new Date(), 'UTC')).toBeNull()
  })

  /**
   * Cross-timezone: the schedule is configured in America/New_York, but the
   * device (and therefore anything that leaned on JS Date's implicit local
   * time) is running in Asia/Karachi (UTC+5, no DST) — 9 hours apart from
   * EDT (UTC-4) at this date. If this function used `now.getDay()` /
   * `now.getHours()` directly (device-local semantics), it would resolve
   * the block using Karachi's wall clock instead of New York's, and get a
   * different (wrong) answer. Pin down that it doesn't.
   */
  it('resolves correctly when now and the configured timezone differ from the device zone', () => {
    const schedule: WeekSchedule = {
      5: [block({ id: 'nyc-morning', startTime: '09:00', endTime: '12:00', dayOfWeek: 5 })],
    }
    // 14:30 UTC on Fri Aug 7 2026 = 10:30 EDT (inside the NYC block) but
    // 19:30 PKT (Asia/Karachi, also Friday) — well outside a 09:00-12:00
    // window if evaluated against Karachi's clock instead.
    const now = new Date('2026-08-07T14:30:00Z')

    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('America/New_York')

    const resolvedForConfiguredZone = resolveActiveBlock(schedule, now, 'America/New_York')
    expect(resolvedForConfiguredZone?.id).toBe('nyc-morning')

    // Sanity check: the same instant evaluated against Karachi's zone does
    // NOT fall inside the 09:00-12:00 window, proving the two zones give
    // genuinely different answers (i.e. the test isn't accidentally
    // timezone-insensitive).
    const resolvedForDeviceZone = resolveActiveBlock(schedule, now, 'Asia/Karachi')
    expect(resolvedForDeviceZone).toBeNull()
  })

  it('handles a DST "spring forward" transition correctly (America/New_York, 2026-03-08)', () => {
    // US Eastern springs forward at 2:00 AM local -> 3:00 AM on 2026-03-08
    // (02:00-03:00 doesn't exist that day). A block scheduled 01:30-03:30
    // local should still resolve correctly right up to and after the gap.
    const schedule: WeekSchedule = {
      0: [block({ id: 'early', startTime: '01:30', endTime: '03:30', dayOfWeek: 0 })], // Sunday
    }

    // 06:45 UTC = 01:45 EST (before spring-forward, EST = UTC-5).
    const beforeGap = new Date('2026-03-08T06:45:00Z')
    expect(resolveActiveBlock(schedule, beforeGap, 'America/New_York')?.id).toBe('early')

    // 07:15 UTC = 03:15 EDT (after spring-forward, EDT = UTC-4) — still
    // inside the block's wall-clock window even though only 30 minutes of
    // real time separate it from the previous instant.
    const afterGap = new Date('2026-03-08T07:15:00Z')
    expect(resolveActiveBlock(schedule, afterGap, 'America/New_York')?.id).toBe('early')

    // 08:00 UTC = 04:00 EDT — past the block's end.
    const afterBlock = new Date('2026-03-08T08:00:00Z')
    expect(resolveActiveBlock(schedule, afterBlock, 'America/New_York')).toBeNull()
  })

  it('handles a DST "fall back" transition correctly (America/New_York, 2026-11-01)', () => {
    // US Eastern falls back at 2:00 AM local -> 1:00 AM on 2026-11-01
    // (01:00-02:00 happens twice in UTC terms). A block scheduled
    // 00:30-01:30 local should resolve consistently using wall-clock time.
    const schedule: WeekSchedule = {
      0: [block({ id: 'fallback-block', startTime: '00:30', endTime: '01:30', dayOfWeek: 0 })], // Sunday
    }

    // 04:45 UTC = 00:45 EDT (before fall-back, EDT = UTC-4).
    const firstPass = new Date('2026-11-01T04:45:00Z')
    expect(resolveActiveBlock(schedule, firstPass, 'America/New_York')?.id).toBe('fallback-block')

    // 06:15 UTC = 01:15 EST (after fall-back, EST = UTC-5) — still within
    // 00:30-01:30 wall-clock, now on the "second" 1am of the day.
    const secondPass = new Date('2026-11-01T06:15:00Z')
    expect(resolveActiveBlock(schedule, secondPass, 'America/New_York')?.id).toBe('fallback-block')
  })
})

describe('findUpcomingScheduleBlocks / findNextScheduleBlock', () => {
  it('finds the next block later the same day, in the configured timezone', () => {
    const schedule: WeekSchedule = {
      5: [
        block({ id: 'morning', startTime: '09:00', endTime: '10:00', dayOfWeek: 5 }),
        block({ id: 'afternoon', startTime: '14:00', endTime: '15:00', dayOfWeek: 5 }),
      ],
    }
    // 10:30 EDT Friday.
    const now = new Date('2026-08-07T14:30:00Z')
    const next = findNextScheduleBlock(schedule, now, 'America/New_York')
    expect(next?.block.id).toBe('afternoon')
    // 14:00 EDT on 2026-08-07 = 18:00 UTC.
    expect(next?.startsAtUtc.toISOString()).toBe('2026-08-07T18:00:00.000Z')
  })

  it('rolls over to the next day (and correctly to the next week) when nothing is left today', () => {
    const schedule: WeekSchedule = {
      5: [block({ id: 'friday-morning', startTime: '09:00', endTime: '10:00', dayOfWeek: 5 })],
      6: [block({ id: 'saturday-morning', startTime: '08:00', endTime: '09:00', dayOfWeek: 6 })],
    }
    // Friday 20:00 EDT — after Friday's only block.
    const now = new Date('2026-08-08T00:00:00Z')
    const next = findNextScheduleBlock(schedule, now, 'America/New_York')
    expect(next?.block.id).toBe('saturday-morning')
    // Saturday 08:00 EDT 2026-08-08 = 12:00 UTC.
    expect(next?.startsAtUtc.toISOString()).toBe('2026-08-08T12:00:00.000Z')
  })

  it('collects multiple upcoming blocks in order, sorted within a day', () => {
    const schedule: WeekSchedule = {
      5: [
        block({ id: 'later', startTime: '16:00', endTime: '17:00', dayOfWeek: 5 }),
        block({ id: 'earlier', startTime: '13:00', endTime: '14:00', dayOfWeek: 5 }),
      ],
    }
    const now = new Date('2026-08-07T12:00:00Z') // 08:00 EDT
    const upcoming = findUpcomingScheduleBlocks(schedule, now, 'America/New_York', 5)
    expect(upcoming.map((u) => u.block.id)).toEqual(['earlier', 'later'])
  })

  it('returns an empty array for a non-positive count or missing schedule', () => {
    expect(findUpcomingScheduleBlocks(undefined, new Date(), 'UTC', 3)).toEqual([])
    expect(findUpcomingScheduleBlocks({}, new Date(), 'UTC', 0)).toEqual([])
  })

  it('advances calendar days correctly across a DST spring-forward boundary', () => {
    // Block on Sunday 2026-03-08 (the spring-forward day) and nothing on
    // Saturday after the query time, so the search has to walk from
    // Saturday across the DST boundary into Sunday.
    const schedule: WeekSchedule = {
      0: [block({ id: 'sunday-after-dst', startTime: '10:00', endTime: '11:00', dayOfWeek: 0 })],
    }
    // Saturday 2026-03-07, 23:00 EST (UTC-5) = 2026-03-08T04:00:00Z.
    const now = new Date('2026-03-08T04:00:00Z')
    const next = findNextScheduleBlock(schedule, now, 'America/New_York')
    expect(next?.block.id).toBe('sunday-after-dst')
    // Sunday 2026-03-08 10:00 EDT (post-transition, UTC-4) = 14:00 UTC.
    expect(next?.startsAtUtc.toISOString()).toBe('2026-03-08T14:00:00.000Z')
  })
})

describe('buildZonedDateFromParts', () => {
  it('builds the correct UTC instant for a wall-clock date/time in a given timezone', () => {
    const instant = buildZonedDateFromParts('2026-08-07', '10:30', 'America/New_York')
    expect(instant.toISOString()).toBe('2026-08-07T14:30:00.000Z')
  })

  it('defaults to midnight when no time is given', () => {
    const instant = buildZonedDateFromParts('2026-08-07', undefined, 'America/New_York')
    expect(instant.toISOString()).toBe('2026-08-07T04:00:00.000Z')
  })

  it('accounts for DST when building an instant on the transition date', () => {
    // 2026-03-08 01:30 EST (before spring-forward) = 06:30 UTC.
    const beforeGap = buildZonedDateFromParts('2026-03-08', '01:30', 'America/New_York')
    expect(beforeGap.toISOString()).toBe('2026-03-08T06:30:00.000Z')

    // 2026-03-08 03:15 EDT (after spring-forward) = 07:15 UTC.
    const afterGap = buildZonedDateFromParts('2026-03-08', '03:15', 'America/New_York')
    expect(afterGap.toISOString()).toBe('2026-03-08T07:15:00.000Z')
  })
})
