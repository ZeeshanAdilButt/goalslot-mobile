// The one hook behind every Messages unread badge — the drawer's Messages
// row and the floating Messages button both call this, so the two can never
// show different numbers.
//
// Reads the conversations query rather than fetching its own. That query is
// already an active observer for the whole authenticated session (AppDrawer
// renders DrawerContent unconditionally), and it is kept current by the
// app-wide messaging socket and the existing foreground invalidate — so a
// second reader costs no request and adds no interval. See
// src/lib/messages-badge.ts for why the count is derived from unread
// CONVERSATIONS and never from notification rows.
//
// `enabled: messagingEnabled` keeps this inert in builds with no messaging
// service configured, matching the nav row and the button themselves.

import { useQuery } from "@tanstack/react-query";

import { deriveMessagesBadgeCount } from "@/lib/messages-badge";
import { messagingEnabled } from "@/lib/messaging-config";
import { messagingQueries } from "@/lib/queries";

export function useUnreadMessagesCount(currentUserId: string | undefined): number {
  const conversationsQuery = useQuery({
    ...messagingQueries.conversations(),
    enabled: messagingEnabled && !!currentUserId,
  });

  return deriveMessagesBadgeCount(conversationsQuery.data, currentUserId);
}
