// The client-side answer to a backend gap: the Coach API keys one
// conversation per (user, scopeKey) — there is no thread id, and no
// "list my conversations" endpoint. So there is nothing server-side to
// enumerate. This module defines the shape of a small local index the app
// keeps instead (see apps/mobile/src/lib/coach-history-store.ts for the
// AsyncStorage-backed half of this), plus the pure helpers for building and
// reordering it. Framework-agnostic and storage-agnostic on purpose,
// matching proposals.ts/day-analysis.ts in this same folder — mobile
// supplies the AsyncStorage read/write glue, but the shape of an entry and
// what counts as "more recent" shouldn't have to be reimplemented if a web
// client ever wants the same feature.
//
// Two kinds of entry:
//   - "live": a conversation the server still has. `id` is always the
//     scopeKey itself — there's no other identity to give it, and the
//     server is still authoritative for its content. Includes the current
//     week and any past week the user has messaged and never cleared.
//   - "archived": a snapshot taken locally right before a destructive
//     "New chat" cleared the server's copy (see coach-history-store.ts's
//     `archiveConversation`). `id` is a generated uuid because the server
//     row it came from is gone — this is the only remaining copy, forever.

export type ConversationKind = 'live' | 'archived'

export interface ConversationIndexEntry {
  id: string
  kind: ConversationKind
  scopeKey: string
  /** Derived from the conversation's first message, truncated. */
  title: string
  /** Derived from the conversation's most recent message, truncated. */
  preview: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/** One role/content pair, independent of whichever screen produced it (Voice's transcript+reply, Coach's CoachMessageDto) — the common shape an archive snapshot is built from. */
export interface ConversationTurnSnapshot {
  role: 'USER' | 'ASSISTANT'
  content: string
}

const DEFAULT_TITLE_MAX = 60
const DEFAULT_PREVIEW_MAX = 100

/**
 * Collapses whitespace/newlines (a multi-line message otherwise breaks a
 * one-line list row) and truncates with an ellipsis. Ported in spirit from
 * apps/mobile's messaging/format.ts `formatMessagePreview` — that one is
 * mobile-only (imports nothing shared-unsafe) so this is a small
 * reimplementation rather than a cross-import.
 */
export function truncateConversationText(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) return collapsed
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/** Title for a new index entry, derived from the conversation's first message. */
export function deriveConversationTitle(firstMessageContent: string): string {
  const truncated = truncateConversationText(firstMessageContent, DEFAULT_TITLE_MAX)
  return truncated.length > 0 ? truncated : 'Conversation'
}

/** Preview line for an index entry, derived from the conversation's most recent message. */
export function deriveConversationPreview(lastMessageContent: string): string {
  return truncateConversationText(lastMessageContent, DEFAULT_PREVIEW_MAX)
}

/** Most recently active conversation first. */
export function sortConversationsByRecency(entries: readonly ConversationIndexEntry[]): ConversationIndexEntry[] {
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Upserts the "live" entry for `scopeKey` — called after every successful
 * send. `id` is always `scopeKey` for a live entry, so this is a lookup by
 * scopeKey, not by id: a fresh entry is created with `messageCount: 1` and
 * `createdAt = now`; an existing one keeps its `createdAt` and gets its
 * `messageCount` incremented, `title` reset only if it didn't have one yet
 * (the first message stays the title for the life of the conversation),
 * and `preview`/`updatedAt` always refreshed to the latest message.
 */
export function upsertLiveConversationEntry(
  entries: readonly ConversationIndexEntry[],
  input: { scopeKey: string; latestMessageContent: string; now: string },
): ConversationIndexEntry[] {
  const existing = entries.find((entry) => entry.kind === 'live' && entry.scopeKey === input.scopeKey)
  const preview = deriveConversationPreview(input.latestMessageContent)

  if (!existing) {
    const fresh: ConversationIndexEntry = {
      id: input.scopeKey,
      kind: 'live',
      scopeKey: input.scopeKey,
      title: deriveConversationTitle(input.latestMessageContent),
      preview,
      createdAt: input.now,
      updatedAt: input.now,
      messageCount: 1,
    }
    return [...entries, fresh]
  }

  return entries.map((entry) =>
    entry === existing
      ? { ...entry, preview, updatedAt: input.now, messageCount: entry.messageCount + 1 }
      : entry,
  )
}

/**
 * "New chat" step 5: after the server conversation for `scopeKey` has been
 * cleared, the live entry for it goes back to looking fresh — zeroed
 * message count, no title/preview left over from the conversation that just
 * got archived. Does not remove the entry: the scopeKey is still a real,
 * still-fetchable (now-empty) server conversation, not gone the way an
 * archived one's server row is.
 */
export function resetLiveConversationEntry(
  entries: readonly ConversationIndexEntry[],
  scopeKey: string,
  now: string,
): ConversationIndexEntry[] {
  return entries.map((entry) =>
    entry.kind === 'live' && entry.scopeKey === scopeKey
      ? { ...entry, title: '', preview: '', messageCount: 0, createdAt: now, updatedAt: now }
      : entry,
  )
}

/** Inserts a freshly-archived entry (see coach-history-store.ts's `archiveConversation`). */
export function insertArchivedConversationEntry(
  entries: readonly ConversationIndexEntry[],
  entry: ConversationIndexEntry,
): ConversationIndexEntry[] {
  return [...entries, entry]
}

/** Local-only "hide from list" — never touches the server conversation a `live` entry points at. */
export function removeConversationIndexEntry(
  entries: readonly ConversationIndexEntry[],
  id: string,
): ConversationIndexEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

/** Builds the id -> title/preview pair an archive snapshot's index entry needs, from the turns being archived. */
export function summariseTurnsForArchive(turns: readonly ConversationTurnSnapshot[]): {
  title: string
  preview: string
} {
  const first = turns.find((turn) => turn.content.trim().length > 0)
  const last = [...turns].reverse().find((turn) => turn.content.trim().length > 0)
  return {
    title: first ? deriveConversationTitle(first.content) : 'Conversation',
    preview: last ? deriveConversationPreview(last.content) : '',
  }
}
