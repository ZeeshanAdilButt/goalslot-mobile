// Ported from dw-time-web/src/lib/api.ts (categoriesApi).

import type { AxiosInstance } from 'axios'

import type { Category, CreateCategoryForm, UpdateCategoryForm } from '../types/category'

export function createCategoriesApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Category[]>('/categories'),
    getOne: (id: string) => api.get<Category>(`/categories/${id}`),
    create: (data: CreateCategoryForm) => api.post<Category>('/categories', data),
    update: (id: string, data: UpdateCategoryForm) => api.put<Category>(`/categories/${id}`, data),
    delete: (id: string) => api.delete(`/categories/${id}`),
  }
}

export type CategoriesApi = ReturnType<typeof createCategoriesApi>
