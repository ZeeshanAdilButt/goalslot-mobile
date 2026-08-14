// Ported from dw-time-web/src/features/goals/utils/queries.ts, re-pointed at
// this package's own api/types instead of `@/lib/api` / `./types`. Wrapped
// in a factory that takes the api endpoint group instead of importing a
// module-level `goalsApi` singleton, so both web and a test suite can hand
// in their own client instance.

import { queryOptions } from '@tanstack/react-query'

import type { GoalsApi } from '../api/goals'
import type { Goal, GoalFilters, GoalStats } from '../types/goal'

export function createGoalQueries(goalsApi: GoalsApi) {
  const goalQueries = {
    all: ['goals'] as const,
    list: (filters?: GoalFilters) => [...goalQueries.all, 'list', filters] as const,
    detail: (id: string) => [...goalQueries.all, 'detail', id] as const,
    stats: () => [...goalQueries.all, 'stats'] as const,
  }

  const fetchGoals = async (filters?: GoalFilters): Promise<Goal[]> => {
    const params: { status?: string; categories?: string; labelIds?: string } = {}

    if (filters?.status) params.status = filters.status
    if (filters?.categories && filters.categories.length > 0) {
      params.categories = filters.categories.join(',')
    }
    if (filters?.labelIds && filters.labelIds.length > 0) {
      params.labelIds = filters.labelIds.join(',')
    }

    const res = await goalsApi.getAll(params)
    return res.data
  }

  const fetchGoalStats = async (): Promise<GoalStats> => {
    const res = await goalsApi.getStats()
    return res.data
  }

  const fetchGoal = async (id: string): Promise<Goal> => {
    const res = await goalsApi.getOne(id)
    return res.data
  }

  return {
    goalQueries,
    fetchGoals,
    fetchGoalStats,
    fetchGoal,
    list: (filters?: GoalFilters) =>
      queryOptions({
        queryKey: goalQueries.list(filters),
        queryFn: () => fetchGoals(filters),
      }),
    detail: (id: string) =>
      queryOptions({
        queryKey: goalQueries.detail(id),
        queryFn: () => fetchGoal(id),
      }),
    stats: () =>
      queryOptions({
        queryKey: goalQueries.stats(),
        queryFn: fetchGoalStats,
      }),
  }
}
