// Ported from dw-time-web/src/lib/api.ts (timeEntriesApi).

import type { AxiosInstance } from 'axios'

import type { TimeEntry } from '../types/time-entry'
import type { CreateTimeEntryInput, UpdateTimeEntryInput } from '../validation/time-entry'

export function createTimeEntriesApi(api: AxiosInstance) {
  return {
    getByWeek: (weekStart: string) => api.get<TimeEntry[]>('/time-entries/week', { params: { weekStart } }),
    getByDateRange: (startDate: string, endDate: string) =>
      api.get<TimeEntry[]>('/time-entries/range', { params: { startDate, endDate } }),
    getToday: () => api.get<TimeEntry[]>('/time-entries/today'),
    getWeeklyTotal: () => api.get<{ totalMinutes: number }>('/time-entries/weekly-total'),
    getRecent: (params?: {
      page?: number
      pageSize?: number
      startDate?: string
      endDate?: string
      search?: string
      goalId?: string
    }) => api.get<TimeEntry[]>('/time-entries/recent', { params }),
    create: (data: CreateTimeEntryInput) => api.post<TimeEntry>('/time-entries', data),
    update: (id: string, data: UpdateTimeEntryInput) => api.put<TimeEntry>(`/time-entries/${id}`, data),
    delete: (id: string) => api.delete(`/time-entries/${id}`),
  }
}

export type TimeEntriesApi = ReturnType<typeof createTimeEntriesApi>
