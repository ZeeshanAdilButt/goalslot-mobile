// The number on the Messages icon. These tests exist to pin the SOURCE of
// that number, not just its arithmetic: once MESSAGE_RECEIVED moved off the
// bell, the tempting shortcut was to count unread MESSAGE_RECEIVED
// notification rows instead. Every case below is one that a row count gets
// wrong.

import { deriveMessagesBadgeCount } from "./messages-badge";

const ME = "user-me";
const THEM = "user-them";

function message(id: string, senderId: string, createdAt: string) {
  return { id, conversationId: `conv-${id}`, senderId, body: "hi", createdAt };
}

function conversation(
  id: string,
  options: { lastReadAt: string | null; lastMessage: ReturnType<typeof message> | null },
) {
  return {
    id,
    participants: [
      { userId: ME, lastReadAt: options.lastReadAt },
      { userId: THEM, lastReadAt: null },
    ],
    lastMessage: options.lastMessage,
  };
}

// react-query hands `undefined` before the first load; the shared types are
// structural, so the fixtures above satisfy them without importing the
// service's own builders.
type Conversations = Parameters<typeof deriveMessagesBadgeCount>[0];

describe("deriveMessagesBadgeCount", () => {
  it("counts conversations with an unread incoming message", () => {
    const conversations = [
      conversation("a", { lastReadAt: "2026-08-16T09:00:00.000Z", lastMessage: message("m1", THEM, "2026-08-16T10:00:00.000Z") }),
      conversation("b", { lastReadAt: "2026-08-16T09:00:00.000Z", lastMessage: message("m2", THEM, "2026-08-16T11:00:00.000Z") }),
    ] as unknown as Conversations;

    expect(deriveMessagesBadgeCount(conversations, ME)).toBe(2);
  });

  it("counts a conversation ONCE however many messages arrived in it", () => {
    // The clearest divergence from a notification-row count: three messages in
    // one thread are three Notification rows but one unread conversation.
    const conversations = [
      conversation("a", { lastReadAt: null, lastMessage: message("m3", THEM, "2026-08-16T12:00:00.000Z") }),
    ] as unknown as Conversations;

    expect(deriveMessagesBadgeCount(conversations, ME)).toBe(1);
  });

  it("clears once the thread has been read", () => {
    // A notification-row count would NOT clear here — only tapping the
    // notification would — so the badge would sit on a message already read.
    const conversations = [
      conversation("a", { lastReadAt: "2026-08-16T13:00:00.000Z", lastMessage: message("m4", THEM, "2026-08-16T12:00:00.000Z") }),
    ] as unknown as Conversations;

    expect(deriveMessagesBadgeCount(conversations, ME)).toBe(0);
  });

  it("never counts your own outgoing message — sending is not reading", () => {
    const conversations = [
      conversation("a", { lastReadAt: "2026-08-16T09:00:00.000Z", lastMessage: message("m5", ME, "2026-08-16T14:00:00.000Z") }),
    ] as unknown as Conversations;

    expect(deriveMessagesBadgeCount(conversations, ME)).toBe(0);
  });

  it("does not count a brand-new thread with no messages", () => {
    const conversations = [conversation("a", { lastReadAt: null, lastMessage: null })] as unknown as Conversations;
    expect(deriveMessagesBadgeCount(conversations, ME)).toBe(0);
  });

  it("is 0 before the conversation list has loaded", () => {
    expect(deriveMessagesBadgeCount(undefined, ME)).toBe(0);
  });

  it("is 0 before the signed-in user is known, rather than counting against a missing id", () => {
    // Without the guard, every conversation's `lastMessage.senderId !== ""`
    // holds, so an empty user id would light the badge up for the user's OWN
    // outgoing messages on the render before auth resolves.
    const conversations = [
      conversation("a", { lastReadAt: null, lastMessage: message("m6", ME, "2026-08-16T14:00:00.000Z") }),
    ] as unknown as Conversations;

    expect(deriveMessagesBadgeCount(conversations, undefined)).toBe(0);
  });
});
