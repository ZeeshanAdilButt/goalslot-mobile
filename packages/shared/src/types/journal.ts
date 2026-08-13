// New: journal did not exist in packages/shared prior to this change (it was
// explicitly cut from the mobile v1 screen list per DECISIONS.md #5, but the
// discovery notes said to simplify the writing habit, not drop it entirely).
// No dw-time-api DTO/controller exists in this checkout to port faithfully
// the way goal.ts/task.ts did — see api/journal.ts for the documented
// assumption about endpoint shape this type is built against.

/**
 * One journal entry, keyed to a single calendar day (YYYY-MM-DD, local
 * device time — see scheduling/time.ts's getLocalDateString/todayKey).
 * One-entry-per-day is a product rule, not just a UI convention: the API is
 * assumed to enforce it (POST for a date that already has an entry should
 * behave like an upsert or reject — see api/journal.ts).
 */
export interface JournalEntry {
  id: string
  date: string
  content: string
  createdAt?: string
  updatedAt?: string
  /**
   * Client-only UI flag: this entry reflects a save that queued to the
   * offline outbox rather than one the server has confirmed. Never sent to
   * or read from the API — see the identical note on `Goal.pendingSync`.
   */
  pendingSync?: boolean
}
