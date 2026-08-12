// New: no web equivalent yet. Messaging is split across two services, and
// the types below keep that split explicit because the two halves are
// authenticated differently and can fail independently.
//
//   1. GoalSlot's own API (the axios instance in ../api/client) mints a
//      short-lived messaging JWT and creates conversations. Creating a
//      conversation is where the *product* rule lives: you may only talk to
//      someone you have a sharing relationship with, enforced server-side,
//      403 otherwise. Nothing on the client is allowed to be the authority
//      on that.
//   2. jiffy-messaging (a standalone service — see jiffy-messaging/README.md)
//      owns conversations, messages, read state, and live delivery. It has no
//      opinion about who may talk to whom; it only checks that the caller is
//      a participant of the conversation it was handed.
//
// Consequently a participant here carries a bare `userId` and nothing else —
// jiffy-messaging has never heard of GoalSlot users. Display names come from
// the sharing directory (../api/sharing) and are joined client-side; see
// ../messaging/contacts.ts.

/** A member of a conversation, as jiffy-messaging knows them. */
export interface MessagingParticipant {
  /** GoalSlot user id. jiffy-messaging stores it as an opaque string. */
  userId: string
  /**
   * ISO instant this participant last called POST /conversations/:id/read,
   * or null if they never have. Drives the unread indicator — see
   * ../messaging/unread.ts.
   */
  lastReadAt: string | null
}

export interface MessagingConversation {
  id: string
  participants: MessagingParticipant[]
  createdAt?: string
  updatedAt?: string
  /**
   * Optional server-side convenience. jiffy-messaging's documented
   * conversation shape doesn't promise this, so every consumer must treat it
   * as absent-by-default and fall back to the thread's own last message.
   */
  lastMessage?: MessagingMessage | null
}

export interface MessagingMessage {
  id: string
  conversationId: string
  senderId: string
  body: string
  /** ISO instant. Messages sort oldest-first by this. */
  createdAt: string
}

/**
 * A message that exists only on this device so far: rendered immediately on
 * send, then either replaced by the server's row or rolled back. `clientId`
 * is what lets the reconciler tell "the server echoed my own message back"
 * from "someone else sent something".
 */
export interface PendingMessagingMessage extends MessagingMessage {
  clientId: string
  status: 'sending' | 'failed' | 'queued'
}

export type MessagingThreadMessage = MessagingMessage | PendingMessagingMessage

export function isPendingMessage(message: MessagingThreadMessage): message is PendingMessagingMessage {
  return 'clientId' in message
}

/** POST /messaging/token on GoalSlot's API. */
export interface MessagingTokenResponse {
  token: string
  /**
   * ISO instant the token stops being accepted, when the server bothers to
   * say. Optional on purpose: the client must never *depend* on being told,
   * because a token can also be revoked early. The token store treats a 401
   * from jiffy-messaging as the real signal and refreshes on it regardless of
   * what this said — `expiresAt` only avoids the pointless round-trip of
   * sending a token already known to be dead.
   */
  expiresAt?: string
}

/** POST /messaging/conversations on GoalSlot's API. */
export interface CreateMessagingConversationInput {
  /** The GoalSlot user id of the person to talk to. */
  userId: string
}

/**
 * One person the signed-in user is allowed to message, assembled from the
 * sharing directory. Not a server shape — see ../messaging/contacts.ts.
 */
export interface MessagingContact {
  userId: string
  name: string
  email: string
  avatar?: string
  /** How the sharing relationship runs, purely for a subtitle in the picker. */
  relationship: 'shared-with-them' | 'shared-with-me' | 'mutual'
}

/** Connection state of the live-delivery socket, for the UI's offline banner. */
export type MessagingSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
