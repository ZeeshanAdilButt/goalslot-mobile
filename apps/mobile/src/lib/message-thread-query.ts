// The message thread's react-query options, extracted out of
// app/(app)/message/[id].tsx so the one thing that was wrong about them is
// unit-testable without a React renderer (see message-thread-query.test.ts).
//
// SAME BUG, SECOND SCREEN. coach-chat-query.ts already documents this class:
// query-client.ts sets `placeholderData: keepPreviousData` as a GLOBAL
// default on every query. That default is right for a filter tab over one
// dataset (goals.tsx's Active/Completed, reports.tsx's period) and wrong
// wherever the key IS the identity of the content rather than a filter over
// it. Commit 543b4e5 fixed it for Coach and scoped the fix to Coach only;
// messaging inherited exactly the same default and nobody opted it out.
//
// Why it bites here specifically: `message/[id]` is a HIDDEN TAB, not a stack
// entry (see that screen's own header comment) — it mounts once and stays
// mounted for the whole session. So the second time the user opens a
// conversation, the observer already holds the PREVIOUS conversation's data,
// and switching `conversationId` hands that straight back as placeholder
// data with `status: "success"`. Concretely, tapping a "<name> sent you a
// message" notification for a different thread:
//
//   * `conversationQuery.isPending || messagesQuery.isPending` is false, so
//     the ThreadSkeleton branch is unreachable;
//   * the FlatList keeps painting the OLD conversation's bubbles under the
//     new route;
//   * `counterpartName` resolves off the old conversation, so the header
//     shows the wrong person's name;
//   * `threadUnreadable` (`isError && messages.length === 0`) is false
//     because `messages` still holds the old thread — so if the new fetch
//     fails (offline, slow, revoked access) the previous conversation stays
//     painted indefinitely under the new id, with no error and no retry.
//
// That is the user's report verbatim: "opening a notification doesn't take me
// to the right message". The routing was already correct — `/message/<id>` is
// pushed with the right id — but the screen at the end of it rendered the
// conversation they were looking at before.
//
// Opting out (rather than gating the skeleton on `isPlaceholderData`) matches
// the decision coach-chat-query.ts made and for the same reason: a different
// person's conversation is not a provisional version of this one, it is
// different content under the wrong label.

import { messagingQueries } from "./queries";

/**
 * `undefined` is written EXPLICITLY, never omitted: react-query merges
 * defaults with a plain object spread, and a spread copies an own property
 * whose value is `undefined`, so this overwrites the global
 * `keepPreviousData`. Omitting the key would inherit it.
 */
const NO_PLACEHOLDER = { placeholderData: undefined } as const;

/** The thread header's conversation (participants -> counterpart name). */
export function messageThreadConversationQuery(conversationId: string) {
  return {
    ...messagingQueries.conversation(conversationId),
    ...NO_PLACEHOLDER,
  };
}

/**
 * The thread's messages. Keeps the screen's own `refetchOnMount: "always"`
 * (live pushes patch this cache directly, but the socket is closed while
 * backgrounded, so returning to a thread must re-read).
 */
export function messageThreadMessagesQuery(conversationId: string) {
  return {
    ...messagingQueries.messages(conversationId),
    ...NO_PLACEHOLDER,
    refetchOnMount: "always" as const,
  };
}
