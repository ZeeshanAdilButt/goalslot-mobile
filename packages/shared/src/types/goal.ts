// Ported from dw-time-web/src/features/goals/utils/types.ts

export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED'

export interface LabelInput {
  name: string
  color?: string
}

export interface GoalLabel {
  id: string
  labelId: string
  label: {
    id: string
    name: string
    value: string
    color: string
  }
}

export interface Goal {
  id: string
  title: string
  description?: string
  category: string
  targetHours: number
  loggedHours: number
  deadline?: string
  status: GoalStatus
  color: string
  labels?: GoalLabel[]
  /**
   * Client-only UI flag: this row reflects an edit that queued to the offline
   * outbox rather than one the server has confirmed. Never sent to or read
   * from the API — set locally on an optimistic cache patch (mobile's
   * goals.tsx / EditGoalSheet.tsx / useQuickAdd.ts) and cleared by the
   * post-sync invalidate once the real record comes back.
   */
  pendingSync?: boolean
}

/**
 * Lightweight goal projection embedded on Task/TimeEntry/ScheduleBlock
 * records returned by list endpoints.
 *
 * Reconciliation note: the web app defined three near-duplicate local
 * `Goal` interfaces for this purpose — features/tasks/utils/types.ts
 * (id, title, color, status, category?, order?), features/time-tracker/utils/types.ts
 * (id, title, color, category?), and the inline `goal` field shape on
 * features/schedule/utils/types.ts's ScheduleBlock (id, title, color, category?).
 * None of them match the full `Goal` type above (no targetHours/loggedHours/labels),
 * because those endpoints only ever return this summary. Consolidated into one
 * shape here (superset of the three) instead of forking it again per domain.
 */
export interface GoalSummary {
  id: string
  title: string
  color: string
  status?: string
  category?: string
  order?: number
}

export interface GoalStats {
  active: number
  completed: number
  paused: number
}

export interface GoalFilters {
  status?: string
  categories?: string[]
  labelIds?: string[]
}

export const GOAL_STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'COMPLETED', label: 'Completed' },
]
