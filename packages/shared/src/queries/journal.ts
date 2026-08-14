// New: no web equivalent to port (journal's features/journal/ directory is
// gone from this checkout — see api/journal.ts for the full context). Built
// against ./goals.ts's exact factory pattern: a `createXApi(api)` group
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

  // A day with no entry yet is a normal, expected state (not an error) — the
  // API is assumed to 404 for it (see api/journal.ts), which this resolves
  // to `null` so screens can render an empty editor instead of an error
  // state on every date that hasn't been written yet.
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
