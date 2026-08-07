import { describe, expect, it } from 'vitest'

import { createGoalSchema, updateGoalSchema } from './goal'
import { createScheduleBlockSchema, updateScheduleBlockSchema } from './schedule'
import { completeTaskSchema, createTaskSchema } from './task'
import { createTimeEntrySchema } from './time-entry'

describe('goal validation', () => {
  it('accepts a minimal valid create payload', () => {
    const result = createGoalSchema.safeParse({ title: 'Learn React', category: 'LEARNING', targetHours: 40 })
    expect(result.success).toBe(true)
  })

  it('rejects an empty title', () => {
    expect(createGoalSchema.safeParse({ title: '', category: 'LEARNING', targetHours: 40 }).success).toBe(false)
  })

  it('rejects targetHours below 1, mirroring the API DTO @Min(1)', () => {
    expect(createGoalSchema.safeParse({ title: 'x', category: 'LEARNING', targetHours: 0 }).success).toBe(false)
  })

  it('update allows a partial payload plus status/loggedHours', () => {
    const result = updateGoalSchema.safeParse({ status: 'COMPLETED', loggedHours: 12.5 })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status enum value', () => {
    expect(updateGoalSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false)
  })
})

describe('task validation', () => {
  it('accepts a minimal valid create payload', () => {
    expect(createTaskSchema.safeParse({ title: 'Write report' }).success).toBe(true)
  })

  it('rejects estimatedMinutes below 1', () => {
    expect(createTaskSchema.safeParse({ title: 'x', estimatedMinutes: 0 }).success).toBe(false)
  })

  it('rejects a non-uuid goalId', () => {
    expect(createTaskSchema.safeParse({ title: 'x', goalId: 'not-a-uuid' }).success).toBe(false)
  })

  it('complete requires actualMinutes >= 1', () => {
    expect(completeTaskSchema.safeParse({ actualMinutes: 0 }).success).toBe(false)
    expect(completeTaskSchema.safeParse({ actualMinutes: 30 }).success).toBe(true)
  })
})

describe('schedule block validation', () => {
  const valid = { title: 'Deep Work', startTime: '09:00', endTime: '12:00', dayOfWeek: 1, category: 'WORK' }

  it('accepts a valid create payload', () => {
    expect(createScheduleBlockSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects malformed HH:mm times', () => {
    expect(createScheduleBlockSchema.safeParse({ ...valid, startTime: '9:00am' }).success).toBe(false)
    expect(createScheduleBlockSchema.safeParse({ ...valid, endTime: '25:00' }).success).toBe(false)
  })

  it('accepts single-digit-hour HH:mm like the API regex allows', () => {
    expect(createScheduleBlockSchema.safeParse({ ...valid, startTime: '9:00' }).success).toBe(true)
  })

  it('rejects dayOfWeek outside 0-6', () => {
    expect(createScheduleBlockSchema.safeParse({ ...valid, dayOfWeek: 7 }).success).toBe(false)
    expect(createScheduleBlockSchema.safeParse({ ...valid, dayOfWeek: -1 }).success).toBe(false)
  })

  it('update accepts updateScope', () => {
    expect(updateScheduleBlockSchema.safeParse({ updateScope: 'series' }).success).toBe(true)
    expect(updateScheduleBlockSchema.safeParse({ updateScope: 'both' }).success).toBe(false)
  })
})

describe('time entry validation', () => {
  it('accepts a minimal valid create payload', () => {
    expect(createTimeEntrySchema.safeParse({ taskName: 'Focus block', duration: 30, date: '2026-08-07' }).success).toBe(
      true,
    )
  })

  it('rejects duration below 1', () => {
    expect(
      createTimeEntrySchema.safeParse({ taskName: 'x', duration: 0, date: '2026-08-07' }).success,
    ).toBe(false)
  })

  it('rejects a missing taskName', () => {
    expect(createTimeEntrySchema.safeParse({ duration: 30, date: '2026-08-07' }).success).toBe(false)
  })
})
