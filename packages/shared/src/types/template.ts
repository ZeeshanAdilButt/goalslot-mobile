// Mirrors goal-slot-api/src/modules/templates/templates.types.ts (and, for
// TemplateSyncResult, templates.service.ts:16-23 — that one shape lives in
// the service file on the API side, not the module's own types file, but the
// wire shape is identical). Also matches goal-slot-web's own copy at
// src/features/library/types.ts, which the same header comment there notes
// is a deliberate duplicate kept feature-local rather than shared — mobile
// instead centralizes it here, same as every other domain type in this
// package (Goal, Task, ...), since apps/mobile has no per-feature type scope
// of its own the way goal-slot-web's `features/` does.

/** Categories drive filtering on the Library screen. A template may belong to more than one. */
export type TemplateCategory = 'schedule' | 'habits' | 'goals' | 'notes' | 'journal'

export interface TemplateScheduleBlock {
  /** 0=Sun, 1=Mon, ... 6=Sat. */
  dayOfWeek: number
  /** "HH:mm" 24-hour. */
  startTime: string
  endTime: string
  title: string
  /** Resolves to a real Goal id at import time if goals are also being imported; otherwise the block is created unlinked. */
  goalRef?: string
  category?: string
}

export interface TemplateGoal {
  /** Local id within this template only — never persisted. */
  ref: string
  title: string
  description?: string
  category?: string
  color: string
  targetHours?: number
  /** Days from import time; the service stamps the actual Date on import. */
  deadlineDays?: number
}

export interface TemplateTask {
  /** If set, links to a TemplateGoal.ref (resolved to a real Goal id when goals are imported too). */
  goalRef?: string
  title: string
  description?: string
  category?: string
  /** Stable per-task key the sync flow dedupes on. Derived from the title when omitted. */
  key?: string
}

export interface TemplateDefinition {
  id: string
  name: string
  description: string
  /** Long-form pitch for the detail screen. Markdown allowed. */
  longDescription?: string
  source: string
  sourceUrl?: string
  featured: boolean
  categories: TemplateCategory[]
  /** All three sections are independently optional — a template can be schedule-only, a goal pack, or all three. */
  schedule?: TemplateScheduleBlock[]
  goals?: TemplateGoal[]
  tasks?: TemplateTask[]
}

/** GET /templates — summaries only; the heavy sections live on the detail response. */
export interface TemplateSummary {
  id: string
  name: string
  description: string
  source: string
  featured: boolean
  categories: TemplateCategory[]
  blockCount: number
  goalCount: number
  taskCount: number
}

export interface TemplateImportOptions {
  schedule: boolean
  goals: boolean
  tasks: boolean
  /** Deletes the user's existing schedule/goals/tasks for whichever sections are being imported, before creating the new rows. Destructive. */
  replaceExisting?: boolean
}

export interface TemplateImportResult {
  templateId: string
  goalsCreated: number
  scheduleBlocksCreated: number
  tasksCreated: number
}

/** POST /templates/:id/sync — tasks-only re-sync for a template already imported. Never touches goals or schedule. */
export interface TemplateSyncResult {
  templateId: string
  tasksAdded: number
  skipped: number
  /** False if the signed-in user never imported this template (no goal carries its templateId) — the caller should prompt "import first" rather than treat 0 added as success. */
  matched: boolean
}
