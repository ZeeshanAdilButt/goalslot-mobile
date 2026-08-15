// Ported from dw-time-web/src/lib/api.ts (scheduleApi).

import type { AxiosInstance } from 'axios'

import type { ScheduleBlock, WeekSchedule } from '../types/schedule'
import type { CreateScheduleBlockInput, UpdateScheduleBlockInput } from '../validation/schedule'
import { idempotentConfig, type IdempotentRequestOptions } from './idempotency'

export function createScheduleApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<ScheduleBlock[]>('/schedule'),
    getWeekly: () => api.get<WeekSchedule>('/schedule/week'),
    getByDay: (dayOfWeek: number) => api.get<ScheduleBlock[]>(`/schedule/day/${dayOfWeek}`),
    /**
     * `options.idempotencyKey` guards the same failure mode
     * ./time-entries.ts's `create` documents in detail: a create that times
     * out client-side after the row already committed server-side, then gets
     * queued to the offline outbox and replayed with no way for the server to
     * recognise the replay as the same request. For schedule blocks that
     * replay doesn't always land as an inert 400 — `ScheduleService.create`'s
     * time-conflict check races the check against the insert (no transaction,
     * no unique constraint), so two attempts close enough together (a live
     * retry landing while a reconnect-triggered outbox drain is replaying the
     * same create) can both pass the check and both insert, producing two
     * real overlapping ScheduleBlock rows for one logical create — which the
     * mobile Timeline then correctly, and confusingly, renders as two
     * side-by-side blocks in what should be a single time slot. Callers must
     * mint the key once per create attempt and reuse it for any outbox
     * replay of that same attempt (see ScheduleBlockSheet.tsx's handleCreate
     * and lib/offline.ts's "schedule-block-create" operation).
     */
    create: (data: CreateScheduleBlockInput, options?: IdempotentRequestOptions) =>
      api.post<ScheduleBlock>('/schedule', data, idempotentConfig(options)),
    update: (id: string, data: UpdateScheduleBlockInput) => api.put<ScheduleBlock>(`/schedule/${id}`, data),
    delete: (id: string) => api.delete(`/schedule/${id}`),
    clearAll: () => api.delete<{ deleted: number }>('/schedule'),
  }
}

export type ScheduleApi = ReturnType<typeof createScheduleApi>
