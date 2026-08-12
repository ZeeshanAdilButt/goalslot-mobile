// Unread state, derived entirely from `lastReadAt` on the signed-in user's
// own participant row. jiffy-messaging tracks no per-message read flags and
// no unread counter, so "unread" is exactly: the newest message in this
// conversation was written after the last time I called
// POST /conversations/:id/read.
//
// Two rules that are easy to get wrong and are therefore pinned here rather
// than re-derived per screen:
//
//   1. Your own message never makes a thread unread. Sending is not reading,
//      so a send leaves `lastReadAt` behind the message you just wrote, and a
//      naive comparison lights up an unread dot on a conversation you are
//      actively typing in.
//   2. A conversation with no messages is not unread. A brand-new thread has
//      a null `lastReadAt` and nothing to have missed.

import type { MessagingConversation, MessagingMessage } from '../types/messaging'

export function findParticipant(conversation: MessagingConversation, userId: string) {
  return conversation.participants.find((participant) => participant.userId === userId)
}

/** The other side of a 1:1 conversation. Undefined for a self-thread. */
export function findCounterpart(conversation: MessagingConversation, currentUserId: string) {
  return conversation.participants.find((participant) => participant.userId !== currentUserId)
}

export function lastReadAtFor(conversation: MessagingConversation, userId: string): number {
  const participant = findParticipant(conversation, userId)
  if (!participant?.lastReadAt) return 0
  const parsed = Date.parse(participant.lastReadAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * `latestMessage` is passed in rather than read off `conversation.lastMessage`
 * because the service doesn't promise that field — the caller supplies
 * whichever it actually has (the list's `lastMessage`, or the newest message
 * held in the thread cache).
 */
export function isConversationUnread(
  conversation: MessagingConversation,
  currentUserId: string,
  latestMessage: MessagingMessage | null | undefined,
): boolean {
  if (!latestMessage) return false
  if (latestMessage.senderId === currentUserId) return false

  const sentAt = Date.parse(latestMessage.createdAt)
  if (Number.isNaN(sentAt)) return false

  return sentAt > lastReadAtFor(conversation, currentUserId)
}

/** How many conversations in the list are unread — for a nav badge. */
export function countUnreadConversations(
  conversations: MessagingConversation[],
  currentUserId: string,
): number {
  return conversations.reduce(
    (total, conversation) =>
      isConversationUnread(conversation, currentUserId, conversation.lastMessage) ? total + 1 : total,
    0,
  )
}
