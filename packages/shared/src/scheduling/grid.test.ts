import { describe, expect, it } from 'vitest'

import type { ScheduleBlock, WeekSchedule } from '../types/schedule'
import { DAY_END_MIN, DAY_START_MIN, hasOverlap, MIN_DURATION, SLOT_MIN, snapMinutes } from './grid'

function block(id: string, startTime: string, endTime: string): ScheduleBlock {
  return {
    id,
    title: id,
    startTime,
    endTime,
    dayOfWeek: 1,
    category: 'WORK',
    color: '#000000',
    isRecurring: true,
    isPrivate: false,
    seriesId: 'series',
  }
}

describe('constants', () => {
  it('matches the web app values', () => {
    expect(DAY_START_MIN).toBe(0)
    expect(DAY_END_MIN).toBe(1440)
    expect(SLOT_MIN).toBe(15)
    expect(MIN_DURATION).toBe(15)
  })
})

describe('snapMinutes', () => {
  it('snaps to the nearest 15-minute slot', () => {
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
  })

  it('clamps to the day bounds', () => {
    expect(snapMinutes(-100)).toBe(0)
    expect(snapMinutes(10000)).toBe(1440)
  })
})

describe('hasOverlap', () => {
  const schedule: WeekSchedule = {
    1: [block('existing', '09:00', '10:00')],
  }

  it('detects an overlapping range on the same day', () => {
    expect(hasOverlap(schedule, 1, timeMin('09:30'), timeMin('10:30'))).toBe(true)
  })

  it('allows a non-overlapping range', () => {
    expect(hasOverlap(schedule, 1, timeMin('10:00'), timeMin('11:00'))).toBe(false)
    expect(hasOverlap(schedule, 1, timeMin('08:00'), timeMin('09:00'))).toBe(false)
  })

  it('ignores a block by id (editing itself)', () => {
    expect(hasOverlap(schedule, 1, timeMin('09:00'), timeMin('10:00'), 'existing')).toBe(false)
  })

  it('treats a different day as having no overlap', () => {
    expect(hasOverlap(schedule, 2, timeMin('09:00'), timeMin('10:00'))).toBe(false)
  })
})

function timeMin(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}
