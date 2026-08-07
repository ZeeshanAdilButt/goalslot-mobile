import { describe, expect, it } from 'vitest'

import { getReportingWeekDates } from './reporting'
import { getLocalDateString } from './time'

describe('getReportingWeekDates', () => {
  it('starts the week on Monday, not Sunday (reporting convention, distinct from WeekSchedule)', () => {
    // 2026-08-07 is a Friday.
    const { start, end, days } = getReportingWeekDates(new Date(2026, 7, 7))
    expect(getLocalDateString(start)).toBe('2026-08-03') // Monday
    expect(getLocalDateString(end)).toBe('2026-08-09') // Sunday
    expect(days).toHaveLength(7)
    expect(getLocalDateString(days[0] as Date)).toBe('2026-08-03')
    expect(getLocalDateString(days[6] as Date)).toBe('2026-08-09')
  })
})
