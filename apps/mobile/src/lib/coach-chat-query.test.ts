// The regression this file exists for: query-client.ts sets
// `placeholderData: keepPreviousData` as a global default, and coach.tsx's
// chat query used to inherit it. That made switching to a different scopeKey
// (i.e. opening a previous chat) resolve to the PREVIOUS conversation's
// messages with `status: "success"`, so `isPending` was false and the screen's
// loading skeleton was unreachable on the exact interaction it was written
// for. See coach-chat-query.ts's header.
//
// Driven through @tanstack/query-core's QueryObserver rather than a React
// renderer — this repo has no component-testing layer, and the behaviour under
// test is entirely in query-core's option resolution, not in any component.
//
// Deliberately asserted against the app's REAL `queryClient` singleton, not a
// fresh `new QueryClient()`: the whole point is that the app's own global
// defaults do not leak into this one query. A fresh client would have no
// `keepPreviousData` to opt out of and the test would pass either way.

import { QueryObserver } from "@tanstack/react-query";

import { coachChatQuery } from "./coach-chat-query";
import { queryClient } from "./query-client";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const WEEK_A = "2026-W33";
const WEEK_B = "2026-W30";

const MESSAGES_A = [
  { id: "a1", role: "USER", content: "How did this week go?", createdAt: "2026-08-14T09:00:00.000Z" },
];

/**
 * `coachChatQuery` sets `staleTime: 0` and `refetchOnMount: "always"`, so a
 * subscribed observer would immediately run the real queryFn — which goes
 * through apiClient to the network, hanging the test worker on an open
 * handle. `enabled: false` stops the fetch without touching how
 * `placeholderData` resolves, which is the only thing under test here.
 */
function options(scopeKey: string) {
  return queryClient.defaultQueryOptions({ ...coachChatQuery(scopeKey), enabled: false });
}

function observe(scopeKey: string) {
  return new QueryObserver(queryClient, options(scopeKey));
}

afterEach(() => {
  queryClient.clear();
});

describe("coachChatQuery", () => {
  it("keys on the scopeKey", () => {
    expect(coachChatQuery(WEEK_A).queryKey).toEqual(["coach", "chat", WEEK_A]);
  });

  it("opts out of the global keepPreviousData default", () => {
    // The resolved options are what query-core actually consults — asserting on
    // the raw object would not prove the global default was overridden.
    const resolved = queryClient.defaultQueryOptions(coachChatQuery(WEEK_A));
    expect(resolved.placeholderData).toBeUndefined();
  });

  it("shows a pending state when switching to an uncached conversation, not the previous one's messages", async () => {
    queryClient.setQueryData(["coach", "chat", WEEK_A], MESSAGES_A);

    const observer = observe(WEEK_A);
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toEqual(MESSAGES_A);

    // The tap: same observer, different conversation, nothing cached for it.
    observer.setOptions(options(WEEK_B));
    const result = observer.getCurrentResult();

    // With the inherited `keepPreviousData` all three of these were inverted:
    // isPending false, isPlaceholderData true, and `data` was WEEK_A's
    // messages — the screen kept painting the old conversation under the new
    // week's read-only banner with no indication anything was happening.
    expect(result.isPending).toBe(true);
    expect(result.isPlaceholderData).toBe(false);
    expect(result.data).toBeUndefined();

    unsubscribe();
  });

  it("does not present an empty outgoing thread as the incoming conversation's content", () => {
    // The nastiest variant: `[]` is *defined*, so it was eligible as
    // keepPreviousData. A 40-message conversation then rendered as coach.tsx's
    // "Ask the Coach anything…" empty state — reachable any Monday morning, or
    // straight after "New chat".
    queryClient.setQueryData(["coach", "chat", WEEK_A], []);

    const observer = observe(WEEK_A);
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(options(WEEK_B));

    const result = observer.getCurrentResult();
    expect(result.data).toBeUndefined();
    expect(result.isPending).toBe(true);

    unsubscribe();
  });

  it("still serves an already-cached conversation instantly", () => {
    queryClient.setQueryData(["coach", "chat", WEEK_A], MESSAGES_A);
    queryClient.setQueryData(["coach", "chat", WEEK_B], []);

    const observer = observe(WEEK_A);
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions(options(WEEK_B));

    // Opting out of the placeholder must not have cost the warm path: a
    // conversation the persisted cache already holds still paints with no
    // pending flash.
    expect(observer.getCurrentResult().isPending).toBe(false);
    expect(observer.getCurrentResult().data).toEqual([]);

    unsubscribe();
  });
});
