// Ported from dw-time-web/src/features/tasks/utils/queries.ts.

import { queryOptions } from '@tanstack/react-query'

import type { TasksApi } from '../api/tasks'
import type { Task, TaskListFilters } from '../types/task'

export function createTaskQueries(tasksApi: TasksApi) {
  const taskQueries = {
    all: ['tasks'] as const,
    list: (filters?: TaskListFilters) => [...taskQueries.all, 'list', filters] as const,
    detail: (id: string) => [...taskQueries.all, 'detail', id] as const,
  }

  const fetchTasks = async (filters?: TaskListFilters): Promise<Task[]> => {
    const res = await tasksApi.list(filters)
    return res.data
  }

  const fetchTask = async (id: string): Promise<Task> => {
    const res = await tasksApi.getOne(id)
    return res.data
  }

  return {
    taskQueries,
    fetchTasks,
    fetchTask,
    list: (filters?: TaskListFilters) =>
      queryOptions({
        queryKey: taskQueries.list(filters),
        queryFn: () => fetchTasks(filters),
      }),
    detail: (id: string) =>
      queryOptions({
        queryKey: taskQueries.detail(id),
        queryFn: () => fetchTask(id),
      }),
  }
}
