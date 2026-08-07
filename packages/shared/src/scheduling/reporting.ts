// Ported from dw-time-web/src/lib/utils.ts (getWeekDates).
//
// Renamed to getReportingWeekDates and confined to its own module: this is a
// Monday-start (`weekStartsOn: 1`) week range, used for reports/analytics
// date pickers. It does NOT correspond to WeekSchedule's day indices, which
// are Sunday=0 (see ./fire-time and ./grid). Keeping these in separate
// modules with different names is deliberate — the web app blurred the two
// conventions together in a few places, which is exactly the bug class this
// split is meant to prevent.

import { addDays, endOfWeek, startOfWeek } from 'date-fns'

export function getReportingWeekDates(date: Date = new Date()): { start: Date; end: Date; days: Date[] } {
  const start = startOfWeek(date, { weekStartsOn: 1 }) // Monday
  const end = endOfWeek(date, { weekStartsOn: 1 })

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(addDays(start, i))
  }

  return { start, end, days }
}
