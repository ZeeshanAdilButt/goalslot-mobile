// Ported from dw-time-web/src/lib/api.ts (goalsApi).

import type { AxiosInstance } from 'axios'

import type { Goal, GoalStats } from '../types/goal'
import type { CreateGoalInput, UpdateGoalInput } from '../validation/goal'
import { idempotentConfig, type IdempotentRequestOptions } from './idempotency'

export function createGoalsApi(api: AxiosInstance) {
  return {
    getAll: (params?: { status?: string; category?: string; categories?: string; labelIds?: string }) =>
      api.get<Goal[]>('/goals', { params }),
    getOne: (id: string) => api.get<Goal>(`/goals/${id}`),
    /**
     * `options.idempotencyKey` guards the same failure mode documented in
     * ./time-entries.ts's `create` and ./schedule.ts's `create`: a create
     * that times out client-side after the row already committed
     * server-side, then gets queued to the offline outbox and replayed with
     * no way for the server to recognise the replay as the same request —
     * producing a real duplicate Goal row. Goal creation has no
     * time-conflict-style check to race (unlike schedule blocks), but the
     * duplicate-on-replay mechanism is identical and just as real; the key
     * must be minted once per create attempt and reused for any outbox
     * replay of that same attempt (see useQuickAdd.ts's `submitGoal` and
     * lib/offline.ts's "goal-create" operation).
     */
    create: (data: CreateGoalInput, options?: IdempotentRequestOptions) =>
      api.post<Goal>('/goals', data, idempotentConfig(options)),
    update: (id: string, data: UpdateGoalInput) => api.put<Goal>(`/goals/${id}`, data),
    delete: (id: string) => api.delete(`/goals/${id}`),
    reorder: (ids: string[]) => api.put('/goals/reorder', { ids }),
    getStats: () => api.get<GoalStats>('/goals/stats'),
  }
}

export type GoalsApi = ReturnType<typeof createGoalsApi>
