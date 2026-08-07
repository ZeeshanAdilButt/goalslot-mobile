// Ported from dw-time-web/src/features/schedule/utils/queries.ts.

import { queryOptions } from '@tanstack/react-query'

import type { ScheduleApi } from '../api/schedule'
import type { WeekSchedule } from '../types/schedule'

export function createScheduleQueries(scheduleApi: ScheduleApi) {
  const scheduleQueries = {
    root: () => ['schedule'] as const,

    weeklyKey: () => [...scheduleQueries.root(), 'weekly'] as const,
  }

  const fetchWeeklySchedule = async (): Promise<WeekSchedule> => {
    const res = await scheduleApi.getWeekly()
    return res.data
  }

  return {
    scheduleQueries,
    fetchWeeklySchedule,
    weekly: () =>
      queryOptions({
        queryKey: scheduleQueries.weeklyKey(),
        queryFn: fetchWeeklySchedule,
      }),
  }
}

export type ScheduleQueries = ReturnType<typeof createScheduleQueries>
