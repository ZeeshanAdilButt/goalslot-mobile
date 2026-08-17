// The Coach chat thread's react-query options, extracted out of coach.tsx so
// the one thing that was subtly wrong about them is unit-testable without a
// React renderer (see coach-chat-query.test.ts).
//
// The bug this exists to prevent: query-client.ts sets
// `placeholderData: keepPreviousData` as a GLOBAL default on every query.
// That default is right for a filter tab over one dataset — goals.tsx keys on
// Active/Completed, reports.tsx on the selected period, and holding the
// outgoing list while the new one loads is what makes those feel instant.
//
// It is wrong here, because `scopeKey` is not a filter over one dataset: it
// IS the conversation's identity. With the global default in force, tapping a
// past chat in CoachHistorySheet hands this observer the PREVIOUS
// conversation's messages as placeholder data, and query-core forces
// `status: "success"` whenever a placeholder resolves. So:
//   - `historyQuery.isPending` is false → coach.tsx's skeleton never renders.
//   - `allMessages.length` is non-zero → the empty state never renders.
//   - the ScrollView keeps painting the conversation the user was ALREADY
//     looking at, unchanged, for the full duration of the network request,
//     while the "Viewing an earlier week — read-only" banner (derived from
//     scopeKey directly, not from the query) flips instantly above it.
// The user taps a row and the screen shows the wrong conversation with no
// indication anything is loading — which reads as "it opened the wrong chat"
// or "it didn't work", not as "it's loading".
//
// Worse variant: an empty outgoing thread has `data === []`, which is
// *defined* and therefore still eligible as keepPreviousData. The placeholder
// becomes `[]`, so a 40-message conversation renders as coach.tsx's "Ask the
// Coach anything…" empty state. Reachable any Monday morning, or right after
// "New chat".
//
// Opting out explicitly (rather than gating the skeleton on
// `isPlaceholderData`, the way reports.tsx dims its charts) is deliberate:
// dim-and-show is right for aggregates over the same shape, but a different
// week's conversation is not a provisional version of this week's — it is
// different content under the wrong label. Turning the placeholder off makes
// `isPending` true on a cold switch, so the skeleton coach.tsx already had
// fires exactly as its author intended, with no second piece of derived state
// to keep in sync.

import { coachQueries } from "./queries";

export function coachChatQuery(scopeKey: string) {
  return {
    ...coachQueries.chat(scopeKey),
    // Explicitly `undefined`, not omitted: queryClient merges defaults with a
    // plain object spread, and a spread copies an own property whose value is
    // `undefined`, so this overwrites the global `keepPreviousData`. Omitting
    // the key would inherit it.
    placeholderData: undefined,
    // A reply that was still streaming server-side when the user navigated
    // away keeps generating on the server (the SSE bridge doesn't cancel on
    // client disconnect for a completed persist), so refetch on every
    // return to this screen picks it up instead of showing a stale thread.
    refetchOnMount: "always" as const,
    staleTime: 0,
  };
}
