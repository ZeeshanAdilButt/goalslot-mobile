// Ported from dw-time-web/src/features/tasks/utils/types.ts

import type { GoalSummary } from './goal'

export type TaskStatus = 'BACKLOG' | 'TODO' | 'DOING' | 'DONE'

/**
 * Lightweight schedule-block projection embedded on a Task.
 * Reconciliation note: the web app's features/tasks/utils/types.ts defined
 * its own local `ScheduleBlock` with this exact shape, which collides with
 * (and is a subset of) the canonical `ScheduleBlock` in ./schedule. Renamed
 * here to avoid the clash — task list endpoints only ever return this
 * summary, never the full block.
 */
export interface TaskScheduleBlockSummary {
  id: string
  title: string
  startTime: string
  endTime: string
  dayOfWeek: number
  goalId?: string
}

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  category?: string
  estimatedMinutes?: number
  actualMinutes?: number
  trackedMinutes?: number
  dueDate?: string
  completedAt?: string
  createdAt?: string
  goalId?: string
  goal?: GoalSummary
  scheduleBlockId?: string
  scheduleBlock?: TaskScheduleBlockSummary
  order?: number
  notes?: string
  /**
   * Client-only UI flag: this row reflects an edit/complete/delete that
   * queued to the offline outbox rather than one the server has confirmed.
   * Never sent to or read from the API — see the identical note on
   * `Goal.pendingSync`.
   */
  pendingSync?: boolean
}

/** Query params accepted by GET /tasks (list-tasks-query.dto.ts on the API). */
export interface TaskListFilters {
  status?: TaskStatus
  statuses?: TaskStatus[]
  scheduleBlockId?: string
  goalId?: string
  dayOfWeek?: number
}
