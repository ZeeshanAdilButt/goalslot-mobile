// No web equivalent to port (journal's features/journal/ directory is gone
// from this checkout — see api/journal.ts for the verified server contract).
// Built against ./goals.ts's exact factory pattern: a `createXApi(api)` group
// wraps a plain namespaced query-key builder plus queryOptions() helpers, so
// screens and tests both depend on this factory rather than a module-level
// singleton.

import { queryOptions } from '@tanstack/react-query'

import type { JournalApi } from '../api/journal'
import type { JournalEntry } from '../types/journal'

export interface JournalDateRange {
  from?: string
  to?: string
}

function isNotFoundError(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404
}

export function createJournalQueries(journalApi: JournalApi) {
  const journalQueries = {
    all: ['journal'] as const,
    list: (range?: JournalDateRange) => [...journalQueries.all, 'list', range] as const,
    byDate: (date: string) => [...journalQueries.all, 'date', date] as const,
  }

  const fetchEntries = async (range?: JournalDateRange): Promise<JournalEntry[]> => {
    const res = await journalApi.list(range)
    return res.data
  }

  // A day with no entry yet is a normal, expected state, and the API agrees:
  // `getOne` returns `row ?? null` and the controller hands that back as a
  // 200 with a `null` body, so the happy path below already resolves to
  // `null` and screens render an empty editor rather than an error state.
  // The 404 branch is kept as defence in depth — a proxy or a future handler
  // change could still produce one, and the caller's contract shouldn't
  // depend on which of the two shapes arrives.
  const fetchEntryByDate = async (date: string): Promise<JournalEntry | null> => {
    try {
      const res = await journalApi.getByDate(date)
      return res.data
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  return {
    journalQueries,
    fetchEntries,
    fetchEntryByDate,
    list: (range?: JournalDateRange) =>
      queryOptions({
        queryKey: journalQueries.list(range),
        queryFn: () => fetchEntries(range),
      }),
    byDate: (date: string) =>
      queryOptions({
        queryKey: journalQueries.byDate(date),
        queryFn: () => fetchEntryByDate(date),
      }),
  }
}
