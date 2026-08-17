// Where a message thread should land when you open it, and whether the
// "Jump to latest" pill has any business being on screen.
//
// The reported bug: opening a conversation dropped the user part-way up the
// history with a "Jump to latest" pill, on threads where they had already
// read every message. The pill's only input was a scroll-offset threshold —
// "are we within 80pt of the bottom" — so it could not express the thing the
// user actually asked for, which is about READ STATE, not position:
//
//   * nothing unread  -> land on the newest message, no pill
//   * unread present  -> land on the first unread message, pill shown
//
// This module is the decision, kept as a pure function so it can be tested as
// data. The scroll mechanics that act on it live in hooks/useThreadScroll.ts,
// and the two are deliberately separate: the mechanics cannot be unit-tested
// without a device, this can.
//
// The two rules below are the same ones packages/shared/src/messaging/unread.ts
// pins for the conversation list, restated here for a single thread rather
// than re-derived per screen:
//
//   1. Your own message never counts as unread. Sending is not reading, so
//      `lastReadAt` sits behind the message you just wrote, and a naive
//      comparison would park you above your own last message.
//   2. A thread with no messages has nothing to have missed.

/** The fields of a thread message this decision actually depends on. */
export interface AnchorMessage {
  id: string;
  senderId: string;
  createdAt: string;
}

export interface ThreadAnchorInput {
  /** Oldest-first, as the thread cache stores them. */
  messages: readonly AnchorMessage[];
  /**
   * Epoch ms of MY OWN participant `lastReadAt`, 0 if I have never read this
   * conversation. Use `lastReadAtFor` from @goalslot/shared to derive it, and
   * snapshot it BEFORE `markRead()` runs — see the caller for why.
   */
  lastReadAt: number;
  currentUserId: string;
}

export interface ThreadAnchor {
  /** Index into `messages` of the first one I have not read, or null. */
  firstUnreadIndex: number | null;
  /** Id of that message, for mapping onto the rendered row list. */
  firstUnreadId: string | null;
  /** True when at least one message from someone else is newer than lastReadAt. */
  hasUnread: boolean;
}

const NOTHING_UNREAD: ThreadAnchor = {
  firstUnreadIndex: null,
  firstUnreadId: null,
  hasUnread: false,
};

/**
 * Decide where to land and whether the pill is warranted.
 *
 * A `lastReadAt` of 0 means "never read this conversation", in which case
 * every message from the other side is unread — the same reading
 * `lastReadAtFor` gives the conversation list, so a thread that shows an
 * unread dot in the list cannot disagree with itself once opened.
 */
export function resolveThreadAnchor({
  messages,
  lastReadAt,
  currentUserId,
}: ThreadAnchorInput): ThreadAnchor {
  if (messages.length === 0) return NOTHING_UNREAD;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    // Rule 1: my own messages are never unread, and must not stop the scan —
    // replying to a thread and then reopening it must still park at the
    // oldest message I have not read, not at my own reply.
    if (message.senderId === currentUserId) continue;

    const sentAt = Date.parse(message.createdAt);
    // An unparseable timestamp cannot be compared. Treating it as unread
    // would strand the user mid-history on bad data, which is the exact
    // failure being fixed — so it is skipped instead.
    if (Number.isNaN(sentAt)) continue;

    if (sentAt > lastReadAt) {
      return { firstUnreadIndex: index, firstUnreadId: message.id, hasUnread: true };
    }
  }

  return NOTHING_UNREAD;
}
