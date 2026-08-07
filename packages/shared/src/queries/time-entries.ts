// Ported from dw-time-web/src/features/time-tracker/utils/queries.ts.
//
// Fixed a bug in the port: the original used
// `new Date(...).toISOString().split('T')[0]` to build the 7-day recent
// window, which reads the date in UTC and shows the wrong calendar day for
// anyone behind UTC (see src/scheduling/time.ts's getLocalDateString doc
// comment for the full explanation). Replaced with getLocalDateString.

import { queryOptions } from '@tanstack/react-query'

import type { TimeEntriesApi } from '../api/time-entries'
import { getLocalDateString } from '../scheduling/time'
import type { TimeEntry } from '../types/time-entry'

const RECENT_WINDOW_DAYS = 7

export function createTimeEntryQueries(timeEntriesApi: TimeEntriesApi) {
  const timeEntryQueries = {
    all: ['time-entries'] as const,
    recent: () => [...timeEntryQueries.all, 'recent'] as const,
    week: (weekStart: string) => [...timeEntryQueries.all, 'week', weekStart] as const,
    range: (startDate: string, endDate: string) => [...timeEntryQueries.all, 'range', startDate, endDate] as const,
    today: () => [...timeEntryQueries.all, 'today'] as const,
  }

  const fetchRecentEntries = async (): Promise<TimeEntry[]> => {
    const end = new Date()
    const start = new Date(end.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const res = await timeEntriesApi.getByDateRange(getLocalDateString(start), getLocalDateString(end))
    return res.data
  }

  const fetchToday = async (): Promise<TimeEntry[]> => {
    const res = await timeEntriesApi.getToday()
    return res.data
  }

  return {
    timeEntryQueries,
    fetchRecentEntries,
    fetchToday,
    recent: () =>
      queryOptions({
        queryKey: timeEntryQueries.recent(),
        queryFn: fetchRecentEntries,
      }),
    today: () =>
      queryOptions({
        queryKey: timeEntryQueries.today(),
        queryFn: fetchToday,
      }),
  }
}

export type TimeEntryQueries = ReturnType<typeof createTimeEntryQueries>
