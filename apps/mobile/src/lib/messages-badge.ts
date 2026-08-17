// THE MESSAGES BADGE — one derivation, named once, so every surface that
// shows it (the drawer's Messages row, the floating Messages button) counts
// the same thing.
//
// SINGLE SOURCE OF TRUTH, stated so it cannot drift: the number is unread
// CONVERSATIONS, derived from the messaging service's own
// `participant.lastReadAt`. The `Notification` table feeds it NOTHING.
//
// Why that matters — the double-count this exists to prevent. Once
// MESSAGE_RECEIVED moved off the bell and onto this icon (see
// ./notification-feed.ts), there were two candidate sources for the number:
// unread conversations, or unread MESSAGE_RECEIVED notification rows. Using
// both, or using the wrong one, is visible as "the number is just wrong":
//
//   * A notification-row count does not clear when you READ the thread. Only
//     tapping the notification clears it. So a user who opens Messages,
//     reads everything, and comes back still sees a badge.
//   * Two messages in one conversation are two notification rows but one
//     unread conversation. The two sources disagree by construction.
//   * `isConversationUnread` already encodes two rules a row count cannot:
//     your OWN message never makes a thread unread (sending is not reading),
//     and a thread with no messages is not unread.
//
// It is also free. `AppDrawer` renders `DrawerContent` unconditionally, so
// `messagingQueries.conversations()` is already an active observer for the
// whole authenticated session — a second reader adds no request and no
// interval. It is kept fresh by the messaging socket
// (useMessagingLiveUpdates) and the existing foreground invalidate, and it
// self-clears the instant a thread is opened, because message/[id]'s
// `markRead` writes `applyReadReceipt` straight into that same cache.
//
// This mirrors web, which backs its own FloatingMessagesButton with
// `useUnreadConversationsCount` over the same conversation list — so the two
// platforms show the same number for the same reason.

import { countUnreadConversations, type MessagingConversation } from "@goalslot/shared";

/**
 * Unread-conversation count for a nav badge, or 0 when there is nothing to
 * count yet.
 *
 * `conversations` is `undefined` while the query is loading and
 * `currentUserId` is `undefined` for the render before auth resolves; both
 * mean "no badge", never a partial count computed against a missing user
 * (which would count the user's own outgoing messages as unread).
 */
export function deriveMessagesBadgeCount(
  conversations: MessagingConversation[] | undefined,
  currentUserId: string | undefined,
): number {
  if (!conversations || !currentUserId) return 0;
  return countUnreadConversations(conversations, currentUserId);
}
