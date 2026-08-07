// Ported from dw-time-web/src/lib/api.ts (scheduleApi).

import type { AxiosInstance } from 'axios'

import type { ScheduleBlock, WeekSchedule } from '../types/schedule'
import type { CreateScheduleBlockInput, UpdateScheduleBlockInput } from '../validation/schedule'

export function createScheduleApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<ScheduleBlock[]>('/schedule'),
    getWeekly: () => api.get<WeekSchedule>('/schedule/week'),
    getByDay: (dayOfWeek: number) => api.get<ScheduleBlock[]>(`/schedule/day/${dayOfWeek}`),
    create: (data: CreateScheduleBlockInput) => api.post<ScheduleBlock>('/schedule', data),
    update: (id: string, data: UpdateScheduleBlockInput) => api.put<ScheduleBlock>(`/schedule/${id}`, data),
    delete: (id: string) => api.delete(`/schedule/${id}`),
    clearAll: () => api.delete<{ deleted: number }>('/schedule'),
  }
}

export type ScheduleApi = ReturnType<typeof createScheduleApi>
