// Journal was cut from the mobile v1 screen list per DECISIONS.md #5, then
// reinstated in a lightweight form (the discovery notes said to simplify the
// writing habit, not drop it entirely). This type used to note that no
// controller existed in the checkout to port from and to point at
// api/journal.ts for the endpoint-shape assumption; goal-slot-api's
// CoachJournalController has since been read, and api/journal.ts documents
// the verified contract.

/**
 * One journal entry, keyed to a single calendar day (YYYY-MM-DD, local
 * device time — see scheduling/time.ts's getLocalDateString/todayKey).
 *
 * One-entry-per-day is enforced by the database, not just by the UI: the row
 * carries a `[userId, date]` composite unique, and `POST /coach/journal/
 * entries` is a Prisma upsert against it. That is why `date` — not `id` — is
 * the key every write and delete in api/journal.ts addresses an entry by.
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
