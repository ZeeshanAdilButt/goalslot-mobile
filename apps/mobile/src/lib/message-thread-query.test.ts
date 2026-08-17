// The regression this file exists for: query-client.ts sets
// `placeholderData: keepPreviousData` as a GLOBAL default, and
// app/(app)/message/[id].tsx used to inherit it for both the conversation and
// the messages query. Because that screen is a hidden tab that stays mounted
// for the whole session, switching conversations (the exact thing a
// "<name> sent you a message" notification tap does) resolved to the PREVIOUS
// conversation's data with `status: "success"` — so the thread skeleton was
// unreachable, the header showed the previous person's name, and a failed
// fetch left the old conversation painted under the new id forever.
//
// Driven through @tanstack/query-core's QueryObserver rather than a React
// renderer, and asserted against the app's REAL `queryClient` singleton, for
// the same two reasons coach-chat-query.test.ts spells out: the behaviour
// under test is entirely in query-core's option resolution, and a fresh
// `new QueryClient()` would have no `keepPreviousData` to opt out of, so the
// test would pass with or without the fix.

import { QueryObserver } from "@tanstack/react-query";

import { messageThreadConversationQuery, messageThreadMessagesQuery } from "./message-thread-query";
import { queryClient } from "./query-client";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const CONVERSATION_A = "conv-alice";
const CONVERSATION_B = "conv-bruno";

const MESSAGES_A = [
  {
    id: "m1",
    conversationId: CONVERSATION_A,
    senderId: "alice",
    body: "Did you finish the report?",
    createdAt: "2026-08-16T09:00:00.000Z",
  },
];

const CONVERSATION_ROW_A = {
  id: CONVERSATION_A,
  participants: [
    { userId: "me", lastReadAt: null },
    { userId: "alice", lastReadAt: null },
  ],
  lastMessage: null,
};

/**
 * `messageThreadMessagesQuery` sets `refetchOnMount: "always"`, so a
 * subscribed observer would run the real queryFn and reach for the messaging
 * service, hanging the worker on an open handle. `enabled: false` stops the
 * fetch without touching how `placeholderData` resolves, which is the only
 * thing under test — same trick coach-chat-query.test.ts uses.
 */
function messagesOptions(conversationId: string) {
  return queryClient.defaultQueryOptions({
    ...messageThreadMessagesQuery(conversationId),
    enabled: false,
  });
}

function conversationOptions(conversationId: string) {
  return queryClient.defaultQueryOptions({
    ...messageThreadConversationQuery(conversationId),
    enabled: false,
  });
}

afterEach(() => {
  queryClient.clear();
});

describe("messageThreadMessagesQuery", () => {
  it("keys on the conversation id", () => {
    expect(messageThreadMessagesQuery(CONVERSATION_A).queryKey).toEqual([
      "messaging",
      "messages",
      CONVERSATION_A,
    ]);
  });

  it("opts out of the global keepPreviousData default", () => {
    // The RESOLVED options are what query-core consults — asserting on the
    // raw object would not prove the global default was overridden.
    const resolved = queryClient.defaultQueryOptions(messageThreadMessagesQuery(CONVERSATION_A));
    expect(resolved.placeholderData).toBeUndefined();
  });

  it("shows a pending state when a notification opens a different conversation, not the previous thread", () => {
    queryClient.setQueryData(["messaging", "messages", CONVERSATION_A], MESSAGES_A);

    const observer = new QueryObserver(queryClient, messagesOptions(CONVERSATION_A));
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toEqual(MESSAGES_A);

    // The tap: same mounted screen, different conversation, nothing cached.
    observer.setOptions(messagesOptions(CONVERSATION_B));
    const result = observer.getCurrentResult();

    // With the inherited `keepPreviousData` all three were inverted: isPending
    // false (so ThreadSkeleton never rendered), isPlaceholderData true, and
    // `data` was Alice's messages sitting under Bruno's route.
    expect(result.isPending).toBe(true);
    expect(result.isPlaceholderData).toBe(false);
    expect(result.data).toBeUndefined();

    unsubscribe();
  });

  it("does not let an empty outgoing thread masquerade as the incoming one", () => {
    // `[]` is *defined*, so it was eligible as keepPreviousData: opening a
    // conversation full of history straight after an empty one rendered the
    // "no messages yet" state over a thread that has plenty.
    queryClient.setQueryData(["messaging", "messages", CONVERSATION_A], []);

    const observer = new QueryObserver(queryClient, messagesOptions(CONVERSATION_A));
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(messagesOptions(CONVERSATION_B));

    const result = observer.getCurrentResult();
    expect(result.data).toBeUndefined();
    expect(result.isPending).toBe(true);

    unsubscribe();
  });

  it("still serves an already-cached conversation instantly", () => {
    queryClient.setQueryData(["messaging", "messages", CONVERSATION_A], MESSAGES_A);
    queryClient.setQueryData(["messaging", "messages", CONVERSATION_B], []);

    const observer = new QueryObserver(queryClient, messagesOptions(CONVERSATION_A));
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(messagesOptions(CONVERSATION_B));

    // Opting out of the placeholder must not have cost the warm path.
    expect(observer.getCurrentResult().isPending).toBe(false);
    expect(observer.getCurrentResult().data).toEqual([]);

    unsubscribe();
  });
});

describe("messageThreadConversationQuery", () => {
  it("keys on the conversation id", () => {
    expect(messageThreadConversationQuery(CONVERSATION_A).queryKey).toEqual([
      "messaging",
      "conversation",
      CONVERSATION_A,
    ]);
  });

  it("opts out of the global keepPreviousData default", () => {
    const resolved = queryClient.defaultQueryOptions(messageThreadConversationQuery(CONVERSATION_A));
    expect(resolved.placeholderData).toBeUndefined();
  });

  it("does not carry the previous conversation's participants into the new thread's header", () => {
    // `counterpartName` is derived from THIS query via `findCounterpart`, so a
    // stale placeholder here is what put the wrong person's name on the
    // header of a conversation opened from a notification.
    queryClient.setQueryData(["messaging", "conversation", CONVERSATION_A], CONVERSATION_ROW_A);

    const observer = new QueryObserver(queryClient, conversationOptions(CONVERSATION_A));
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(conversationOptions(CONVERSATION_B));

    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isPending).toBe(true);

    unsubscribe();
  });
});
