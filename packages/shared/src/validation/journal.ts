// Mirrors goal-slot-api's UpsertJournalEntryDto and UpdateJournalContentDto
// (src/modules/coach-journal/dto/). This file used to say no such DTO existed
// in the checkout to mirror and point at api/journal.ts for an "assumption
// writeup"; both DTOs have since been read, and api/journal.ts now documents
// the verified contract instead.
//
// Still deliberately permissive about EMPTINESS: content has no minimum
// length, because opening today's page and typing nothing is a normal state,
// not a validation error. The constraints below are only the ones the server
// genuinely enforces and would 400 on — catching them here saves a round trip
// that comes back as an unexplained failure.

import { z } from 'zod'

/** `@MaxLength(65535)` on both DTOs' `content` — "TipTap HTML can be large; allow up to ~64KB". */
export const MAX_JOURNAL_CONTENT_LENGTH = 65535

/** The DTOs' own `@Matches(/^\d{4}-\d{2}-\d{2}$/)`, and the route regex for every by-date path. */
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

export const upsertJournalEntrySchema = z.object({
  date: z.string().regex(YYYY_MM_DD, 'Date must be YYYY-MM-DD'),
  content: z.string().max(MAX_JOURNAL_CONTENT_LENGTH, 'Entry is too long to save'),
})

export const updateJournalEntrySchema = z.object({
  content: z.string().max(MAX_JOURNAL_CONTENT_LENGTH, 'Entry is too long to save'),
})

/** @deprecated Alias of `upsertJournalEntrySchema` — POST is a create-or-update, not a create. */
export const createJournalEntrySchema = upsertJournalEntrySchema

export type UpsertJournalEntryInput = z.infer<typeof upsertJournalEntrySchema>
/** @deprecated Alias of `UpsertJournalEntryInput`. */
export type CreateJournalEntryInput = UpsertJournalEntryInput
export type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>
