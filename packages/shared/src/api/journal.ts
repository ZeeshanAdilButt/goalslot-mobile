// Journal: one entry per calendar day, and the DATE is its identity.
//
// VERIFIED against goal-slot-api's CoachJournalController
// (src/modules/coach-journal/coach-journal.controller.ts) plus the DTOs and
// service beside it. This file previously carried a long "documented
// assumption" preamble — no journal module existed in the checkout to port
// from the way goals.ts/tasks.ts did, so the endpoint shapes were inferred
// from this product's other date-keyed routes. That module has now been read,
// and two of the inferred shapes were wrong:
//
//   inferred  PUT    /coach/journal/entries/:id            { content }
//   ACTUAL    PUT    /coach/journal/entries/:date/content  { content }
//
//   inferred  DELETE /coach/journal/entries/:id
//   ACTUAL    DELETE /coach/journal/entries/:date
//
// Not a near miss. Both real routes pin their param with a
// `\d{4}-\d{2}-\d{2}` regex (the controller's own `DATE_PARAM`), which a cuid
// can never satisfy — so the two inferred calls did not reach the wrong
// handler, they matched NO route and 404'd unconditionally. Saving an edit to
// an already-saved entry was impossible, and so was deleting one.
//
// The verified surface:
//
//   GET    /coach/journal/entries?from=&to=                  -> JournalEntry[]  (server defaults to the last 60 days)
//   GET    /coach/journal/entries/:date                      -> JournalEntry | null
//   POST   /coach/journal/entries       { date, content }    -> JournalEntry    (UPSERT on [userId, date])
//   PUT    /coach/journal/entries/:date/content { content }  -> JournalEntry    (upserts too)
//   PUT    /coach/journal/entries/:date/mood { mood, energy} -> JournalEntry    (no client yet — see below)
//   DELETE /coach/journal/entries/:date                      -> { success: true } (idempotent)
//
// `upsert` is THE write, and that is the whole design. POST is a real Prisma
// upsert on the `[userId, date]` composite unique, so a caller never has to
// know whether a day already has a row — which means there is no create-vs-
// update decision for a client to make, and therefore none for it to get
// wrong. `mood`/`energy` are accepted by the same POST body
// (UpsertJournalEntryDto) but no client sends them yet and `JournalEntry`
// carries no such fields; the dedicated `/mood` route is listed above only so
// the next person can see it exists rather than re-deriving it.

import type { AxiosInstance } from 'axios'

import type { JournalEntry } from '../types/journal'
import type {
  CreateJournalEntryInput,
  UpdateJournalEntryInput,
  UpsertJournalEntryInput,
} from '../validation/journal'

export function createJournalApi(api: AxiosInstance) {
  return {
    list: (params?: { from?: string; to?: string }) =>
      api.get<JournalEntry[]>('/coach/journal/entries', { params }),

    // Resolves to `null`, not a 404, on a day with no entry: the service
    // returns `row ?? null` and the controller hands that straight back as a
    // 200. queries/journal.ts still catches a 404 defensively, but it is the
    // null body that actually does the work.
    getByDate: (date: string) => api.get<JournalEntry | null>(`/coach/journal/entries/${date}`),

    /**
     * Create-or-update a day's entry. The only write a journal client needs.
     *
     * Safe to replay, which is what makes it the right thing to sit in the
     * offline outbox: re-POSTing the same `{ date, content }` converges on the
     * same single row rather than stacking duplicates, and a queued save no
     * longer has to be ordered against whether that day's row exists yet.
     */
    upsert: (data: UpsertJournalEntryInput) => api.post<JournalEntry>('/coach/journal/entries', data),

    /**
     * @deprecated Alias of `upsert` — the name is a leftover from when this
     * client believed create and update were different endpoints. It happens
     * to have always pointed at the right route, which is why a FIRST save
     * for a day was the one journal write that worked.
     *
     * Kept only because app/(app)/voice.tsx still calls it. Prefer `upsert`.
     */
    create: (data: CreateJournalEntryInput) => api.post<JournalEntry>('/coach/journal/entries', data),

    /**
     * Set one day's content, keyed by DATE — never by id. The API has no
     * by-id write of any kind; an entry's id is a read-only artifact.
     *
     * Redundant with `upsert` for every current caller (it upserts too, and
     * takes the date in the body instead of the path), and kept only because
     * app/(app)/voice.tsx still calls it. THAT CALL SITE IS STILL WRONG: it
     * passes `existing.id`, a cuid, which the `\d{4}-\d{2}-\d{2}` route
     * constraint rejects. Fixing it is a one-argument change (pass the date
     * it already has in scope) — or better, switch it to `upsert`, which is
     * what its sibling create branch already does.
     */
    update: (date: string, data: UpdateJournalEntryInput) =>
      api.put<JournalEntry>(`/coach/journal/entries/${date}/content`, data),

    /**
     * Remove a whole day's entry, by date. Idempotent server-side (the
     * service uses `deleteMany`, which never throws on a missing row), so a
     * replayed or duplicated delete is harmless.
     */
    delete: (date: string) => api.delete<{ success: true }>(`/coach/journal/entries/${date}`),
  }
}

export type JournalApi = ReturnType<typeof createJournalApi>
