// The live-delivery socket and the cache writes it drives. Module scope, not
// a React hook, because there must be exactly ONE socket per app process no
// matter how many screens are mounted — a per-screen socket would open a
// second connection every time the user opened a thread, and each would
// deliver its own copy of every message.
//
// `useMessagingLiveUpdates` (src/hooks) owns the lifecycle around this:
// connect while authenticated and foregrounded, disconnect on background.
//
// Cache-write rules, in order of how easy they are to get wrong:
//
//   1. A thread cache is only PATCHED, never CREATED, by a push. Seeding
//      ['messaging','messages',id] from a single socket frame would leave a
//      thread that renders as "one message, fully loaded" — no skeleton, no
//      history — until something happened to refetch it. If the key isn't
//      already in the cache, the push is dropped: opening that thread fetches
//      the real history anyway.
//   2. A push for a conversation missing from the list means the LIST is
//      stale (someone just started a new thread), so it invalidates rather
//      than inventing a conversation with no participants.
//   3. Read state is not touched here. Marking the thread read is a
//      deliberate act of the thread screen while it's focused — a message
//      arriving in a background thread must stay unread.

import {
  applyMessageToConversations,
  createMessagingSocket,
  reconcileIncomingMessage,
  type MessagingConversation,
  type MessagingMessage,
  type MessagingSocketStatus,
  type MessagingThreadMessage,
} from "@goalslot/shared";

import { getMessagingWsUrl } from "./messaging-config";
import { messagingTokenStore } from "./messaging-client";
import { isOnline, subscribeOnline } from "./offline";
import { messagingQueries } from "./queries";
import { queryClient } from "./query-client";
import { useAuthStore } from "@/providers/auth-provider";

type IncomingListener = (message: MessagingMessage) => void;

// Screens subscribe to hear about pushes AFTER they've been folded into the
// cache — used by the thread screen for its screen-reader announcement. Kept
// separate from the cache write so a screen can never miss a message by
// mounting a moment late: the cache is already correct either way.
const listeners = new Set<IncomingListener>();

export function subscribeToIncomingMessages(listener: IncomingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyIncomingMessage(message: MessagingMessage): void {
  const messagesKey = messagingQueries.messagingQueries.messages(message.conversationId);

  // Rule 1: patch only what already exists.
  if (queryClient.getQueryData<MessagingThreadMessage[]>(messagesKey)) {
    // `reconcileIncomingMessage`, not a plain upsert: a socket push for the
    // sender's OWN just-sent message can't match the optimistic bubble by id
    // (see that function's own comment for why) and needs the current
    // user's id to know which case it's even in.
    const currentUserId = useAuthStore.getState().user?.id;
    queryClient.setQueryData<MessagingThreadMessage[]>(messagesKey, (existing) =>
      reconcileIncomingMessage(existing ?? [], message, currentUserId),
    );
  }

  const conversationsKey = messagingQueries.messagingQueries.conversations();
  const conversations = queryClient.getQueryData<MessagingConversation[]>(conversationsKey);

  if (!conversations) {
    // Nothing cached yet — whoever mounts the list next will fetch it.
    return;
  }

  const patched = applyMessageToConversations(conversations, message);
  if (patched === conversations) {
    // Rule 2: unknown conversation, so the list itself is out of date.
    void queryClient.invalidateQueries({ queryKey: conversationsKey });
    return;
  }
  queryClient.setQueryData(conversationsKey, patched);
}

let currentStatus: MessagingSocketStatus = "idle";
const statusListeners = new Set<(status: MessagingSocketStatus) => void>();

export function subscribeToSocketStatus(listener: (status: MessagingSocketStatus) => void): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getSocketStatus(): MessagingSocketStatus {
  return currentStatus;
}

export const messagingSocket = createMessagingSocket({
  getWsUrl: getMessagingWsUrl,
  getToken: (options) => messagingTokenStore.getToken(options),
  onMessage: (message) => {
    applyIncomingMessage(message);
    listeners.forEach((listener) => listener(message));
  },
  onStatusChange: (status) => {
    currentStatus = status;
    statusListeners.forEach((listener) => listener(status));
  },
  // Reuses the app's single NetInfo subscription (src/lib/offline.ts) rather
  // than opening a second one, so the socket and the offline outbox can never
  // disagree about whether the device is online.
  isOnline,
});

/**
 * Reconnects when connectivity comes back.
 *
 * Necessary because the socket deliberately does NOT retry on a timer while
 * offline (see the shared socket module) — a handshake that cannot complete
 * is pure battery cost. This is the edge that wakes it back up, and it's an
 * edge rather than a poll: `connect()` on an already-open socket is a no-op,
 * so a flapping connection doesn't churn the connection.
 */
export function startMessagingConnectivityWatch(): () => void {
  return subscribeOnline((online) => {
    if (online && currentStatus !== "open") {
      messagingSocket.connect();
    }
  });
}
