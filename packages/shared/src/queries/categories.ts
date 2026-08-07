// Ported from dw-time-web/src/features/categories/utils/queries.ts.

import { queryOptions } from '@tanstack/react-query'

import type { CategoriesApi } from '../api/categories'
import type { Category } from '../types/category'

export function createCategoryQueries(categoriesApi: CategoriesApi) {
  const baseKey = ['categories'] as const

  const categoryQueries = {
    all: () => baseKey,
    listKey: () => [...baseKey, 'list'] as const,
    detailKey: (id: string) => [...baseKey, 'detail', id] as const,
  }

  const fetchCategories = async (): Promise<Category[]> => {
    const res = await categoriesApi.getAll()
    return res.data
  }

  const fetchCategory = async (id: string): Promise<Category> => {
    const res = await categoriesApi.getOne(id)
    return res.data
  }

  return {
    categoryQueries,
    fetchCategories,
    fetchCategory,
    list: () =>
      queryOptions<Category[]>({
        queryKey: categoryQueries.listKey(),
        queryFn: fetchCategories,
        // Refetch on every mount + window focus so newly seeded categories
        // show up without a hard reload.
        staleTime: 0,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
      }),
    detail: (id: string) =>
      queryOptions<Category>({
        queryKey: categoryQueries.detailKey(id),
        queryFn: () => fetchCategory(id),
      }),
  }
}

export type CategoryQueries = ReturnType<typeof createCategoryQueries>
