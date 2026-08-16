// Ported from dw-time-web/src/lib/api.ts (tasksApi).

import type { AxiosInstance } from 'axios'

import type { Task, TaskListFilters } from '../types/task'
import type { CompleteTaskInput, CreateTaskInput, UpdateTaskInput } from '../validation/task'
import { idempotentConfig, type IdempotentRequestOptions } from './idempotency'

export function createTasksApi(api: AxiosInstance) {
  return {
    /**
     * `options.idempotencyKey` guards the same failure mode documented in
     * ./time-entries.ts's `create`: a create that times out client-side
     * after the row already committed server-side, then gets queued to the
     * offline outbox and replayed with no way for the server to recognise
     * the replay as the same request — producing a real duplicate Task row.
     * Key minted once per create attempt, reused for any outbox replay of
     * that same attempt (see useQuickAdd.ts's `submitTask` and
     * lib/offline.ts's "task-create" operation).
     */
    create: (data: CreateTaskInput, options?: IdempotentRequestOptions) =>
      api.post<Task>('/tasks', data, idempotentConfig(options)),
    list: (params?: TaskListFilters) => api.get<Task[]>('/tasks', { params }),
    getOne: (id: string) => api.get<Task>(`/tasks/${id}`),
    update: (id: string, data: UpdateTaskInput) => api.put<Task>(`/tasks/${id}`, data),
    delete: (id: string) => api.delete(`/tasks/${id}`),
    /**
     * `options.idempotencyKey`: unlike a plain field-replacement update,
     * completing a task is NOT idempotent server-side — `TasksService.complete`
     * unconditionally creates a new TimeEntry row (and recomputes the goal's
     * loggedHours) on every call that has remaining minutes to log. A replay
     * of a create-that-actually-committed-but-timed-out-client-side would log
     * the same completion's minutes a second time, inflating both the task's
     * logged time and its goal's loggedHours. Same key-per-attempt contract as
     * `create` above (see tasks.tsx's `handleComplete` and lib/offline.ts's
     * "task-complete" operation).
     */
    complete: (id: string, data: CompleteTaskInput, options?: IdempotentRequestOptions) =>
      api.post<Task>(`/tasks/${id}/complete`, data, idempotentConfig(options)),
    restore: (id: string) => api.post<Task>(`/tasks/${id}/restore`),
    reorder: (ids: string[]) => api.put('/tasks/reorder', { ids }),
  }
}

export type TasksApi = ReturnType<typeof createTasksApi>
