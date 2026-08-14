// Ported from dw-time-web/src/lib/api.ts (timeEntriesApi).

import type { AxiosInstance } from 'axios'

import type { TimeEntry } from '../types/time-entry'
import type { CreateTimeEntryInput, UpdateTimeEntryInput } from '../validation/time-entry'
import { idempotentConfig, type IdempotentRequestOptions } from './idempotency'

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
    /**
     * `options.idempotencyKey` is what stops a timed-out create from being
     * logged twice, and it is the one call in this file that genuinely needs
     * it — see ./idempotency for the server contract.
     *
     * This endpoint is both the slowest write the API has (the handler runs
     * several sequential Prisma round-trips: relation ownership checks, an
     * optional task-title lookup, a same-day entry count, a plan-limit user
     * fetch, the insert, then a goal-progress recompute) and the only one
     * whose payload cannot be reconstructed if it is lost — elapsed time that
     * was measured and then dropped is gone. Those two facts together are why
     * every caller wraps it in "queue the payload if no response came back",
     * and a cold-start request that exceeds the client's 20s timeout hits
     * exactly that path having ALREADY committed its row. Without a key held
     * constant across the live attempt and its replays, each replay inserts
     * another copy — bounded in practice only by whatever eventually returns
     * a real response (on the FREE plan, the daily entry cap 403, which is
     * why the duplicates arrived in threes).
     *
     * Callers must mint the key once per stopped session / spoken log, pass
     * it here, and reuse that same value as the outbox entry's
     * `idempotencyKey` so the replay carries it too. Minting a fresh key per
     * attempt reintroduces the bug in full.
     */
    create: (data: CreateTimeEntryInput, options?: IdempotentRequestOptions) =>
      api.post<TimeEntry>('/time-entries', data, idempotentConfig(options)),
    update: (id: string, data: UpdateTimeEntryInput) => api.put<TimeEntry>(`/time-entries/${id}`, data),
    delete: (id: string) => api.delete(`/time-entries/${id}`),
  }
}

export type TimeEntriesApi = ReturnType<typeof createTimeEntriesApi>
