// Ported from goal-slot-web's `src/features/library/api.ts`, re-pointed at
// this package's own types instead of the feature-local copy web keeps (see
// ../types/template.ts's header for why mobile centralizes it here instead).
// Matches goal-slot-api's templates.controller.ts field-for-field: four
// endpoints, all JwtAuthGuard'd, no client-side capability beyond that.

import type { AxiosInstance } from 'axios'

import type {
  TemplateDefinition,
  TemplateImportOptions,
  TemplateImportResult,
  TemplateSummary,
  TemplateSyncResult,
} from '../types/template'

export function createTemplatesApi(api: AxiosInstance) {
  return {
    /** GET /templates — browse list. Summaries only. */
    list: () => api.get<TemplateSummary[]>('/templates'),
    /** GET /templates/:id — full definition (schedule/goals/tasks) for the detail screen. */
    getOne: (id: string) => api.get<TemplateDefinition>(`/templates/${id}`),
    /** POST /templates/:id/import — each section is opt-in per `options`. */
    import: (id: string, options: TemplateImportOptions) =>
      api.post<TemplateImportResult>(`/templates/${id}/import`, options),
    /** POST /templates/:id/sync — tasks-only re-sync for a template already imported. */
    sync: (id: string) => api.post<TemplateSyncResult>(`/templates/${id}/sync`),
  }
}

export type TemplatesApi = ReturnType<typeof createTemplatesApi>
