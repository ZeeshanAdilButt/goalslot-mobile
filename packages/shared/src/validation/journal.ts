// New: did not exist on web. No dw-time-api DTO exists in this checkout to
// mirror (unlike goal.ts/task.ts's "Mirrors dw-time-api/.../dto" comments) —
// see api/journal.ts for the full assumption writeup. Kept deliberately
// permissive (content has no min-length) since an empty journal entry — the
// user opened today's page and typed nothing — should not be a validation
// error; the screen simply won't call create/update for empty content.

import { z } from 'zod'

export const createJournalEntrySchema = z.object({
  date: z.string().min(1, 'Date is required'),
  content: z.string(),
})

export const updateJournalEntrySchema = z.object({
  content: z.string(),
})

export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>
export type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>
