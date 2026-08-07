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

export interface CreateGoalForm {
  title: string
  description?: string
  category: string
  targetHours: number
  deadline?: string
  color: string
  status?: GoalStatus
  labels?: LabelInput[] // Label objects with name and color
}

export interface UpdateGoalForm extends Partial<CreateGoalForm> {
  status?: GoalStatus
  loggedHours?: number
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

// Notion-style label colors
export const LABEL_COLORS = [
  { name: 'Red', value: '#FEE2E2', textColor: '#991B1B' },
  { name: 'Orange', value: '#FED7AA', textColor: '#9A3412' },
  { name: 'Yellow', value: '#FEF3C7', textColor: '#92400E' },
  { name: 'Green', value: '#D1FAE5', textColor: '#065F46' },
  { name: 'Cyan', value: '#CFFAFE', textColor: '#0E7490' },
  { name: 'Blue', value: '#DBEAFE', textColor: '#1E40AF' },
  { name: 'Purple', value: '#E9D5FF', textColor: '#6B21A8' },
  { name: 'Pink', value: '#FCE7F3', textColor: '#9D174D' },
  { name: 'Gray', value: '#E5E7EB', textColor: '#374151' },
] as const

export const GOAL_STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'COMPLETED', label: 'Completed' },
]
