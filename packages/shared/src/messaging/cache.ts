// Pure reconcilers for the message/conversation caches. Every one of these
// takes the current array and returns a new one — no query client, no React,
// no platform. That is what lets the tricky cases (a socket push racing the
// POST response for the same message, a page of history arriving after a live
// message) be unit tested as data rather than as a UI bug someone reports
// three weeks later.
//
// The hard problem these solve: the same message reaches the client twice.
// Once as the 201 body of the send, once as a WebSocket push, in either
// order, and the optimistic bubble the user is already looking at is a third
// copy with a different id. Dedupe therefore runs on two keys — the server id
// AND the client id — and a server row always wins over a pending one.

import type {
  MessagingConversation,
  MessagingMessage,
  MessagingThreadMessage,
  PendingMessagingMessage,
} from '../types/messaging'
import { isPendingMessage } from '../types/messaging'

/** Oldest-first, matching the order the service returns history in. */
function byCreatedAtAscending(a: MessagingThreadMessage, b: MessagingThreadMessage): number {
  const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  // Two messages can share a timestamp at millisecond resolution. Falling
  // back to id keeps the order stable across re-renders instead of letting
  // the sort shuffle them, which reads as bubbles swapping places.
  return delta !== 0 ? delta : a.id.localeCompare(b.id)
}

export function sortMessages(messages: MessagingThreadMessage[]): MessagingThreadMessage[] {
  return [...messages].sort(byCreatedAtAscending)
}

/**
 * Inserts or replaces one message.
 *
 * Matching order matters: `clientId` is checked first so the server's echo
 * lands *on top of* the optimistic bubble (same position, no duplicate, no
 * flicker) rather than beside it. A server row without a matching clientId
 * falls back to id matching, which is what makes a socket push idempotent.
 */
export function upsertMessage(
  existing: MessagingThreadMessage[],
  incoming: MessagingThreadMessage,
): MessagingThreadMessage[] {
  const incomingClientId = isPendingMessage(incoming) ? incoming.clientId : undefined

  const index = existing.findIndex((message) => {
    if (incomingClientId && isPendingMessage(message) && message.clientId === incomingClientId) {
      return true
    }
    return message.id === incoming.id
  })

  if (index === -1) {
    return sortMessages([...existing, incoming])
  }

  const next = [...existing]
  next[index] = incoming
  return sortMessages(next)
}

/**
 * Replaces the optimistic bubble identified by `clientId` with the row the
 * server created. Separate from `upsertMessage` because the ids differ: the
 * pending copy is keyed by clientId and the confirmed one by the server's id,
 * so a plain upsert would leave both.
 */
export function confirmPendingMessage(
  existing: MessagingThreadMessage[],
  clientId: string,
  confirmed: MessagingMessage,
): MessagingThreadMessage[] {
  const withoutPending = existing.filter(
    (message) => !(isPendingMessage(message) && message.clientId === clientId),
  )
  // Still an upsert rather than a push: the socket may already have delivered
  // this exact message while the POST response was in flight.
  return upsertMessage(withoutPending, confirmed)
}

/** Drops an optimistic bubble outright — the rollback half of a failed send. */
export function removePendingMessage(
  existing: MessagingThreadMessage[],
  clientId: string,
): MessagingThreadMessage[] {
  return existing.filter((message) => !(isPendingMessage(message) && message.clientId === clientId))
}

/** Marks an optimistic bubble failed (or queued) in place, keeping it on screen. */
export function markPendingMessage(
  existing: MessagingThreadMessage[],
  clientId: string,
  status: PendingMessagingMessage['status'],
): MessagingThreadMessage[] {
  return existing.map((message) =>
    isPendingMessage(message) && message.clientId === clientId ? { ...message, status } : message,
  )
}

/**
 * Folds a live message into the conversation list so the list reorders and
 * re-previews without a refetch.
 *
 * Returns the input array unchanged when the conversation isn't in the list —
 * a message for an unknown conversation means the list itself is stale (the
 * other person just opened a new thread), which is a refetch, not a patch we
 * can invent participants for.
 */
export function applyMessageToConversations(
  conversations: MessagingConversation[],
  message: MessagingMessage,
): MessagingConversation[] {
  const index = conversations.findIndex((conversation) => conversation.id === message.conversationId)
  if (index === -1) return conversations

  const target = conversations[index]
  if (!target) return conversations

  const updated: MessagingConversation = {
    ...target,
    lastMessage: message,
    updatedAt: message.createdAt,
  }

  // Most-recent-first, which is the order the list renders in.
  return [updated, ...conversations.filter((_, i) => i !== index)]
}

/**
 * Writes a local `lastReadAt` for the signed-in user so the unread dot clears
 * the instant the thread opens, rather than after the next list refetch.
 */
export function applyReadReceipt(
  conversations: MessagingConversation[],
  conversationId: string,
  userId: string,
  readAt: string,
): MessagingConversation[] {
  return conversations.map((conversation) => {
    if (conversation.id !== conversationId) return conversation
    return {
      ...conversation,
      participants: conversation.participants.map((participant) =>
        participant.userId === userId ? { ...participant, lastReadAt: readAt } : participant,
      ),
    }
  })
}

/**
 * Merges a page of older history under the messages already held.
 *
 * `before`-paged history and live pushes arrive on independent paths, so the
 * page can legitimately overlap what's on screen. Deduping by id (server rows
 * only ever carry ids) and re-sorting is cheaper and far more robust than
 * trying to reason about cursor boundaries.
 */
export function mergeOlderMessages(
  existing: MessagingThreadMessage[],
  older: MessagingMessage[],
): MessagingThreadMessage[] {
  const seen = new Set(existing.map((message) => message.id))
  const additions = older.filter((message) => !seen.has(message.id))
  if (additions.length === 0) return existing
  return sortMessages([...additions, ...existing])
}

/** ISO timestamp of the oldest message held, i.e. the next `before` cursor. */
export function oldestMessageTimestamp(messages: MessagingThreadMessage[]): string | undefined {
  const serverMessages = messages.filter((message) => !isPendingMessage(message))
  return serverMessages[0]?.createdAt
}

/**
 * Folds a freshly fetched page of server messages into what's already held,
 * KEEPING any optimistic messages.
 *
 * This is the one that stops a real bug: a refetch (screen focus, app resume,
 * pull-to-refresh) replaces the query's data wholesale, and a message the
 * user sent while offline lives only in that cache until the outbox drains.
 * Without this, coming back to a thread makes their queued message vanish —
 * and it will still be sent later, so it reappears minutes afterwards.
 *
 * History that has been paged in is also preserved: the fetch returns only
 * the newest page, so a plain replace would silently collapse a thread the
 * user had scrolled back through.
 */
export function mergeServerMessages(
  previous: MessagingThreadMessage[] | undefined,
  incoming: MessagingMessage[],
): MessagingThreadMessage[] {
  if (!previous || previous.length === 0) return sortMessages(incoming)

  const incomingIds = new Set(incoming.map((message) => message.id))
  const kept = previous.filter(
    (message) =>
      // Optimistic messages the server hasn't seen yet…
      isPendingMessage(message) ||
      // …and older confirmed messages this page doesn't cover.
      !incomingIds.has(message.id),
  )

  return sortMessages([...kept, ...incoming])
}

/**
 * Newest CONFIRMED message in a thread, for a conversation-list preview.
 *
 * Pending ones are excluded deliberately. A row's preview and unread state
 * are both statements about what the server holds, and an optimistic bubble
 * that later fails would otherwise leave the list showing a message that was
 * never sent.
 *
 * Exists because the conversation list can't rely on the service populating
 * `lastMessage` — where it doesn't, a thread the user has already opened is
 * still cached locally and can supply the preview.
 */
export function newestServerMessage(
  messages: MessagingThreadMessage[] | undefined,
): MessagingMessage | undefined {
  if (!messages) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message && !isPendingMessage(message)) return message
  }
  return undefined
}
