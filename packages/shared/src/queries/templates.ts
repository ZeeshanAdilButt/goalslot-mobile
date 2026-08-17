// Query-key factory + queryOptions for the Library's two reads (browse list,
// template detail), same factory-around-the-api-group shape as ./sharing and
// ./goals.
//
// Import and sync are deliberately NOT wrapped as mutation helpers here —
// this package has no established "mutation factory" convention (grep the
// rest of ./queries: every file here is reads only), and every existing
// mutation in apps/mobile calls its `apiClient.<domain>.<verb>()` directly
// from the component and invalidates by hand (see
// AssignInstructionSheet.tsx). The Library screens follow that same
// pattern — see apps/mobile's library/[id].tsx.

import { queryOptions } from '@tanstack/react-query'

import type { TemplatesApi } from '../api/templates'
import type { TemplateDefinition, TemplateSummary } from '../types/template'

export function createTemplateQueries(api: TemplatesApi) {
  const templateQueries = {
    all: ['templates'] as const,
    list: () => [...templateQueries.all, 'list'] as const,
    detail: (id: string) => [...templateQueries.all, 'detail', id] as const,
  }

  const fetchTemplates = async (): Promise<TemplateSummary[]> => (await api.list()).data

  const fetchTemplate = async (id: string): Promise<TemplateDefinition> => (await api.getOne(id)).data

  return {
    templateQueries,
    fetchTemplates,
    fetchTemplate,
    list: () =>
      queryOptions({
        queryKey: templateQueries.list(),
        queryFn: fetchTemplates,
      }),
    detail: (id: string) =>
      queryOptions({
        queryKey: templateQueries.detail(id),
        queryFn: () => fetchTemplate(id),
      }),
  }
}

export type TemplateQueries = ReturnType<typeof createTemplateQueries>
