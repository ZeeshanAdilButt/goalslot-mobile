// New: journal did not exist in packages/shared prior to this change (see
// ../types/journal.ts and DECISIONS.md #5 — cut from v1's screen list, but
// the discovery notes said to simplify the writing habit, not drop it).
//
// Assumption, documented since it isn't verified against a live DTO/controller:
// no dw-time-api journal module exists in this checkout to port faithfully
// the way goals.ts/tasks.ts did (those carry "Ported from ..." / "Mirrors
// dw-time-api/.../dto" comments because a real source existed to check
// against). scheduling/time.ts's todayKey() doc comment is the only evidence
// left in this repo that a journal feature ever existed on web
// (features/journal/... call sites it lists), and that directory is gone
// from this checkout.
//
// Endpoint shape below follows this product's established date-keyed API
// pattern (schedule's /schedule/day/:dayOfWeek, time-entries' date-range
// query params) and is namespaced under /coach the way an AI-coach-adjacent
// reflective feature like journal plausibly would be on this API:
//
//   GET    /coach/journal/entries?from=YYYY-MM-DD&to=YYYY-MM-DD  -> JournalEntry[]
//   GET    /coach/journal/entries/:date                          -> JournalEntry (404 if none that day)
//   POST   /coach/journal/entries        { date, content }       -> JournalEntry
//   PUT    /coach/journal/entries/:id    { content }             -> JournalEntry
//   DELETE /coach/journal/entries/:id
//
// If the real API differs (e.g. update-by-date instead of update-by-id, or a
// different path prefix), this module is the single place to correct it —
// queries/journal.ts and the mobile screen only ever go through this factory.

import type { AxiosInstance } from 'axios'

import type { JournalEntry } from '../types/journal'
import type { CreateJournalEntryInput, UpdateJournalEntryInput } from '../validation/journal'

export function createJournalApi(api: AxiosInstance) {
  return {
    list: (params?: { from?: string; to?: string }) =>
      api.get<JournalEntry[]>('/coach/journal/entries', { params }),
    getByDate: (date: string) => api.get<JournalEntry>(`/coach/journal/entries/${date}`),
    create: (data: CreateJournalEntryInput) => api.post<JournalEntry>('/coach/journal/entries', data),
    update: (id: string, data: UpdateJournalEntryInput) =>
      api.put<JournalEntry>(`/coach/journal/entries/${id}`, data),
    delete: (id: string) => api.delete(`/coach/journal/entries/${id}`),
  }
}

export type JournalApi = ReturnType<typeof createJournalApi>
