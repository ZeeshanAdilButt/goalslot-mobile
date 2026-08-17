// What the BELL is a feed of — one constant, imported by every surface that
// touches it, because the failure mode of getting this wrong is silent.
//
// THE INFORMATION ARCHITECTURE, stated once:
//
//   "I think messages notification should be under the messages icon not the
//    notification itself"
//
// A new message now surfaces on the MESSAGES icon (the drawer's Messages row
// and the floating Messages button, both counting unread CONVERSATIONS) and
// nowhere else in-app. The bell is for the things that have no other home: a
// mentor's instruction, a shared report going unviewed, a release. The push
// notification itself is unchanged — the user still gets alerted on their
// phone that a message arrived; this is about which in-app surface owns it,
// not about delivery.
//
// TWO SOURCES OF TRUTH, KEPT APART. This is the double-count trap and it is
// worth being explicit about:
//
//   * The MESSAGES badge counts unread CONVERSATIONS
//     (`countUnreadConversations` over the messaging service's own
//     `participant.lastReadAt` — see src/lib/messages-badge.ts). The
//     `Notification` table feeds it nothing.
//   * The BELL badge counts unread `Notification` rows in this scope, which
//     excludes MESSAGE_RECEIVED entirely.
//
// So one incoming message is exactly +1 on Messages and +0 on the bell. If
// the bell also counted it, a user reading the thread would clear the
// Messages badge and leave the bell stuck at 1 for a message they had already
// read — the number would look simply wrong, which is the concrete shape
// "double counting" takes here.
//
// WHY THE SERVER FILTERS RATHER THAN THIS CLIENT. Two reasons, both fatal to
// the client-side version:
//
//   1. `unreadCount` is computed server-side over the same predicate as
//      `items`. Filtering rows out in a `useMemo` here would leave the bell
//      badge reading "3" above a screen showing nothing.
//   2. Pagination is cursor-based. Dropping rows after they arrive means a
//      20-row page can render completely empty while `hasMore` is still true,
//      and "load more" has to be tapped blind.
//
// GRACEFUL ON AN OLD SERVER: `scope` is read off a bare `@Query('scope')`,
// not a whitelisted DTO, so a server that predates the parameter ignores it
// and answers exactly as it does today (message notifications still in the
// feed) rather than rejecting the request.

import type { NotificationScope } from "@goalslot/shared";

/**
 * The scope the bell — its badge, its list, and its "Mark all read" — all
 * operate in. These three MUST agree: a "mark all read" run at a wider scope
 * than the list clears rows the user was never shown.
 */
export const BELL_SCOPE: NotificationScope = "general";
