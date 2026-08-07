// Ported from dw-time-web/src/lib/api.ts (labelsApi).

import type { AxiosInstance } from 'axios'

import type { CreateLabelForm, Label, UpdateLabelForm } from '../types/label'

export function createLabelsApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Label[]>('/labels'),
    getOne: (id: string) => api.get<Label>(`/labels/${id}`),
    create: (data: CreateLabelForm) => api.post<Label>('/labels', data),
    update: (id: string, data: UpdateLabelForm) => api.put<Label>(`/labels/${id}`, data),
    delete: (id: string) => api.delete(`/labels/${id}`),
    assignToGoal: (goalId: string, labelIds: string[]) =>
      api.post(`/labels/goals/${goalId}/assign`, { labelIds }),
    getForGoal: (goalId: string) => api.get<Label[]>(`/labels/goals/${goalId}`),
  }
}

export type LabelsApi = ReturnType<typeof createLabelsApi>
