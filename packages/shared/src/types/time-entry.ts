// Ported from dw-time-web/src/features/time-tracker/utils/types.ts

import type { GoalSummary } from './goal'

export interface TimeEntryScheduleBlockSummary {
  id: string
  title: string
  category?: string
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
