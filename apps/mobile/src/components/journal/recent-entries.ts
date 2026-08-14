// Pure row/copy logic for the Journal screen's "Recent entries" list.
//
// Split out of app/(app)/journal.tsx for the same reason session-entries.ts
// was split out of SessionHistory.tsx: this repo unit-tests its extracted
// pure layers rather than rendering screens, and the destructive-confirmation
// copy and the optimistic cache write are both things worth a regression test.
// The screen keeps the rendering; everything below is a plain function of its
// arguments.
//
// Date FORMATTING deliberately stays in the screen and arrives here as an
// already-rendered `dateLabel`. `toLocaleDateString` output depends on the
// device locale, so a helper that formatted its own dates could only be
// tested against whatever locale the test runner happened to have.

import { type JournalEntry } from "@goalslot/shared";

import { htmlToPlainText } from "@/lib/note-content";

/**
 * How much of an entry a row's screen-reader label reads out. A journal entry
 * is long-form prose, and a label that recited the whole day would be
 * unusable to page through — this is a "which day is this?" cue, matching the
 * single visible line the row shows sighted users.
 */
const PREVIEW_LABEL_CHARS = 80;

/**
 * The plain text of an entry.
 *
 * Entries authored in the web app's TipTap editor are stored as HTML, so
 * anything that shows or measures an entry as text has to flatten it first —
 * otherwise a literal `<blockquote><p><em>` ends up on screen and in what a
 * screen reader speaks. It also means emptiness must be judged on the
 * flattened text: a structurally non-empty but wordless document like
 * `<p></p>` is non-empty by `length` alone and would otherwise read as
 * content.
 */
export function journalEntryPreview(content: string): string {
  return htmlToPlainText(content);
}

/** Whether an entry has anything a person actually wrote in it. */
export function hasJournalContent(content: string): boolean {
  return journalEntryPreview(content).length > 0;
}

/**
 * Word count of a piece of writing. Shared by the editor's live counter (on
 * the raw draft) and the delete confirmation (on a flattened entry) so the
 * two can never quote different numbers for the same text.
 */
export function countJournalWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * One-line screen-reader description of a row. "No content" is stated rather
 * than left silent: it is exactly what the visible italic placeholder conveys
 * to everyone else, and it tells a VoiceOver user which days are worth
 * opening.
 */
export function describeRecentEntry(entry: JournalEntry, dateLabel: string): string {
  const preview = journalEntryPreview(entry.content);
  return preview.length > 0
    ? `${dateLabel}, ${preview.slice(0, PREVIEW_LABEL_CHARS)}`
    : `${dateLabel}, no content`;
}

/**
 * Copy for the delete confirmation.
 *
 * Quantifies what disappears — a day's writing, in words — rather than saying
 * "this item", because prose is the thing the user cannot get back by
 * retyping it from memory. The date is named too, unlike SessionHistory's
 * equivalent: this list has no day headers above the rows, so the row's own
 * date is the only thing identifying which entry is about to go.
 *
 * An empty day gets its own, softer sentence. Deleting one destroys nothing,
 * and warning that it "can't be undone" would be theatre.
 */
export function describeJournalDelete(
  entry: JournalEntry,
  dateLabel: string,
): { title: string; description: string } {
  const words = countJournalWords(journalEntryPreview(entry.content));
  return {
    title: "Delete this entry?",
    description:
      words === 0
        ? `Your ${dateLabel} entry is empty and will be removed.`
        : `${words === 1 ? "1 word" : `${words} words`} written on ${dateLabel} will be removed. This can't be undone.`,
  };
}

/**
 * Optimistic cache write for a delete: the list without that day.
 *
 * Keyed by DATE, not id — one entry per day is a database-level rule (the
 * `[userId, date]` composite unique the API upserts against), and date is
 * what the DELETE endpoint itself addresses, so filtering on anything else
 * would let the list and the request disagree about what was removed.
 */
export function removeJournalEntry(entries: JournalEntry[], date: string): JournalEntry[] {
  return entries.filter((entry) => entry.date !== date);
}
