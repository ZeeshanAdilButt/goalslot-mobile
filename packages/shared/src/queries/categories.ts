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
        // Previously `staleTime: 0`, so that a backend backfill of newly
        // seeded categories appeared without a hard reload. That backfill has
        // long since shipped, and on mobile the setting was much more
        // expensive than it looks: six screens read this list (Goals,
        // Reports, Categories, the schedule block sheet, the goal sheet,
        // quick-add), they are tabs rather than pushed screens, and with
        // `staleTime: 0` every single visit to any of them refetched the
        // user's ~8 unchanging categories.
        //
        // Five minutes keeps the "shows up on its own" property while letting
        // one fetch serve a whole session's worth of tab switching. The
        // user's own edits are unaffected: category mutations invalidate this
        // key, which refetches regardless of staleTime.
        staleTime: 5 * 60 * 1000,
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
