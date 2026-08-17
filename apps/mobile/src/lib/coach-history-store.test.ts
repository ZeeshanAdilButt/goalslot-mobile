// Regression coverage for `backfillFromServer`, the "Previous chats" recovery
// pass that runs once per app session on the first sheet open.
//
// Two things were wrong with it, both of which the user experienced as
// "opening a previous chat is slow / seems is not working":
//
//   1. It fetched up to four weeks of chat history SERIALLY — an awaited
//      request inside a `for…of` — so the sheet's list was rewritten only
//      after four full round trips had completed one after another.
//   2. It read the index once at the top, then wrote that pre-network
//      snapshot back at the bottom. Any `recordConversationActivity` write
//      that landed during those seconds (both Coach and Voice call it after
//      every send) was silently erased.
//
// Both are tested here against a real in-memory AsyncStorage rather than
// assertion-only mocks, so the second test can observe what actually ended up
// persisted. AsyncStorage is stubbed the same way schedule-reminders-store.test.ts
// and timer-store.test.ts stub it; `./api-client` is mocked because the module
// imports it at load time.

import { backfillFromServer, listConversations, recordConversationActivity } from "./coach-history-store";
import { apiClient } from "./api-client";

const mockStore = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    // Async on purpose, not `Promise.resolve` of a sync read: the interleaving
    // these tests exercise only exists because storage reads and writes are
    // separated by awaits.
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));

jest.mock("./api-client", () => ({
  apiClient: {
    coach: {
      getChatHistory: jest.fn(),
    },
  },
}));

const getChatHistory = apiClient.coach.getChatHistory as jest.MockedFunction<
  typeof apiClient.coach.getChatHistory
>;

/** One USER + one ASSISTANT message, the minimum `backfillFromServer` needs to build an entry. */
function historyResponse(scopeKey: string) {
  return {
    data: [
      {
        id: `${scopeKey}-1`,
        role: "USER",
        content: `Question asked in ${scopeKey}`,
        createdAt: "2026-08-01T10:00:00.000Z",
      },
      {
        id: `${scopeKey}-2`,
        role: "ASSISTANT",
        content: `Answer given in ${scopeKey}`,
        createdAt: "2026-08-01T10:00:05.000Z",
      },
    ],
  };
}

/** A `getChatHistory` mock whose responses are all held open until the returned `release` is called. */
function deferredHistory() {
  const releases: (() => void)[] = [];
  getChatHistory.mockImplementation((scopeKey: string) => {
    return new Promise((resolve) => {
      releases.push(() => resolve(historyResponse(scopeKey) as never));
    }) as never;
  });
  return {
    releaseAll: () => {
      for (const release of releases) release();
    },
  };
}

/**
 * A `getChatHistory` mock that records a send for `scopeKey` from inside the
 * FIRST response, i.e. after `backfillFromServer` has already taken its index
 * snapshot but before it writes one back — the real-world race, since both
 * Coach and Voice call `recordConversationActivity` after every send and the
 * backfill runs unawaited in the background.
 */
function interleaveSendDuringBackfill(scopeKey: string) {
  let interleaved = false;
  getChatHistory.mockImplementation(async (requested: string) => {
    if (!interleaved) {
      interleaved = true;
      await recordConversationActivity(scopeKey, "Message sent during the backfill");
    }
    return historyResponse(requested) as never;
  });
}

/** Lets every already-queued microtask (and the awaited AsyncStorage reads) run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe("backfillFromServer", () => {
  it("fetches every missing week concurrently rather than one after another", async () => {
    const { releaseAll } = deferredHistory();

    const pending = backfillFromServer(["2026-W30", "2026-W31", "2026-W32", "2026-W33"]);
    await flush();

    // The point of the test: all four requests are in flight at once while
    // NONE of them has resolved. Serially awaited in a loop this is 1, because
    // the second iteration can't start until the first response lands.
    expect(getChatHistory).toHaveBeenCalledTimes(4);

    releaseAll();
    await pending;
  });

  it("keeps a conversation recorded while the backfill was in flight", async () => {
    // Interleaved from inside the mock rather than by holding responses open,
    // so this test is about the stale-snapshot write alone and fails by
    // assertion under BOTH the old serial implementation and the new
    // concurrent one.
    interleaveSendDuringBackfill("2026-W34");

    await backfillFromServer(["2026-W30", "2026-W31"]);

    const scopeKeys = (await listConversations()).map((entry) => entry.scopeKey);
    // Previously the pre-network index snapshot was written back over the top
    // of this, and the just-sent conversation vanished from the list.
    expect(scopeKeys).toContain("2026-W34");
    expect(scopeKeys).toEqual(expect.arrayContaining(["2026-W30", "2026-W31"]));
  });

  it("does not produce duplicate ids when a send races a recovery of the same week", async () => {
    // Same scopeKey the backfill is recovering. A live entry's id IS its
    // scopeKey, so an unfiltered concat would put two rows with the same key
    // into the sheet's FlatList.
    interleaveSendDuringBackfill("2026-W30");

    await backfillFromServer(["2026-W30", "2026-W31"]);

    const entries = await listConversations();
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The fresher, locally-recorded entry is the one that survives.
    const w30 = entries.filter((entry) => entry.scopeKey === "2026-W30");
    expect(w30).toHaveLength(1);
    expect(w30[0].preview).toBe("Message sent during the backfill");
  });

  it("skips weeks the index already knows as live", async () => {
    await recordConversationActivity("2026-W31", "Already known");
    getChatHistory.mockResolvedValue(historyResponse("2026-W30") as never);

    await backfillFromServer(["2026-W30", "2026-W31"]);

    expect(getChatHistory).toHaveBeenCalledTimes(1);
    expect(getChatHistory).toHaveBeenCalledWith("2026-W30");
  });

  it("still recovers the other weeks when one request fails", async () => {
    getChatHistory.mockImplementation((scopeKey: string) => {
      if (scopeKey === "2026-W30") return Promise.reject(new Error("offline")) as never;
      return Promise.resolve(historyResponse(scopeKey)) as never;
    });

    await backfillFromServer(["2026-W30", "2026-W31"]);

    const scopeKeys = (await listConversations()).map((entry) => entry.scopeKey);
    expect(scopeKeys).toEqual(["2026-W31"]);
  });
});
