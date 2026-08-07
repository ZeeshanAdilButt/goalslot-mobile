// Ported from dw-time-web/src/features/time-tracker/utils/types.ts

import type { GoalSummary } from './goal'
import type { TaskStatus } from './task'

export interface TimeEntryScheduleBlockSummary {
  id: string
  title: string
  category?: string
}

/**
 * Lightweight task projection embedded on a TimeEntry.
 * Reconciliation note: web's features/time-tracker/utils/types.ts defined its
 * own local `Task` (id, title, category?, goalId?, goalTitle?, goal?, status,
 * scheduleBlockId?) that collides with the canonical `Task` in ./task.
 * Renamed here to avoid the clash.
 */
export interface TimeEntryTaskSummary {
  id: string
  title: string
  category?: string
  goalId?: string
  goalTitle?: string
  goal?: GoalSummary
  status: TaskStatus
  scheduleBlockId?: string
}

export interface TimeEntry {
  id: string
  taskName: string
  notes?: string
  duration: number
  date: string
  scheduleBlockId?: string
  scheduleBlock?: TimeEntryScheduleBlockSummary
  goalId?: string
  goal?: GoalSummary
  startedAt?: string
  taskId?: string
  taskTitle?: string
}

export interface CreateTimeEntryPayload {
  taskName: string
  taskId?: string
  taskTitle?: string
  duration: number
  date: string
  notes?: string
  goalId?: string
  startedAt?: string
  scheduleBlockId?: string
}

export interface UpdateTimeEntryPayload {
  taskName?: string
  taskId?: string
  taskTitle?: string
  duration?: number
  date?: string
  notes?: string
  goalId?: string
  startedAt?: string
  scheduleBlockId?: string
}
