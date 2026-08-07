// Ported from dw-time-web/src/lib/api.ts (goalsApi).

import type { AxiosInstance } from 'axios'

import type { Goal, GoalStats } from '../types/goal'
import type { CreateGoalInput, UpdateGoalInput } from '../validation/goal'

export function createGoalsApi(api: AxiosInstance) {
  return {
    getAll: (params?: { status?: string; category?: string; categories?: string; labelIds?: string }) =>
      api.get<Goal[]>('/goals', { params }),
    getOne: (id: string) => api.get<Goal>(`/goals/${id}`),
    create: (data: CreateGoalInput) => api.post<Goal>('/goals', data),
    update: (id: string, data: UpdateGoalInput) => api.put<Goal>(`/goals/${id}`, data),
    delete: (id: string) => api.delete(`/goals/${id}`),
    reorder: (ids: string[]) => api.put('/goals/reorder', { ids }),
    getStats: () => api.get<GoalStats>('/goals/stats'),
  }
}

export type GoalsApi = ReturnType<typeof createGoalsApi>
