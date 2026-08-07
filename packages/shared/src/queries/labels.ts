// Ported from dw-time-web/src/features/labels/utils/queries.ts.

import { queryOptions } from '@tanstack/react-query'

import type { LabelsApi } from '../api/labels'
import type { Label } from '../types/label'

export function createLabelQueries(labelsApi: LabelsApi) {
  const baseKey = ['labels'] as const

  const labelQueries = {
    all: () => baseKey,
    listKey: () => [...baseKey, 'list'] as const,
    detailKey: (id: string) => [...baseKey, 'detail', id] as const,
  }

  const fetchLabels = async (): Promise<Label[]> => {
    const res = await labelsApi.getAll()
    return res.data
  }

  const fetchLabel = async (id: string): Promise<Label> => {
    const res = await labelsApi.getOne(id)
    return res.data
  }

  return {
    labelQueries,
    fetchLabels,
    fetchLabel,
    list: () =>
      queryOptions<Label[]>({
        queryKey: labelQueries.listKey(),
        queryFn: fetchLabels,
      }),
    detail: (id: string) =>
      queryOptions<Label>({
        queryKey: labelQueries.detailKey(id),
        queryFn: () => fetchLabel(id),
      }),
  }
}

export type LabelQueries = ReturnType<typeof createLabelQueries>
