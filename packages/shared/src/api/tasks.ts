// Ported from dw-time-web/src/lib/api.ts (tasksApi).

import type { AxiosInstance } from 'axios'

import type { Task, TaskListFilters } from '../types/task'
import type { CompleteTaskInput, CreateTaskInput, UpdateTaskInput } from '../validation/task'

export function createTasksApi(api: AxiosInstance) {
  return {
    create: (data: CreateTaskInput) => api.post<Task>('/tasks', data),
    list: (params?: TaskListFilters) => api.get<Task[]>('/tasks', { params }),
    getOne: (id: string) => api.get<Task>(`/tasks/${id}`),
    update: (id: string, data: UpdateTaskInput) => api.put<Task>(`/tasks/${id}`, data),
    delete: (id: string) => api.delete(`/tasks/${id}`),
    complete: (id: string, data: CompleteTaskInput) => api.post<Task>(`/tasks/${id}/complete`, data),
    restore: (id: string) => api.post<Task>(`/tasks/${id}/restore`),
    reorder: (ids: string[]) => api.put('/tasks/reorder', { ids }),
  }
}

export type TasksApi = ReturnType<typeof createTasksApi>
