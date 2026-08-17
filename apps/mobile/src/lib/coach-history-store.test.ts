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
//
// The last describe covers a separate defect in the same module: the write
// paths did not honour the header's "none of it throws on a storage failure"
// promise, which is what let a full disk strand the "New chat" dialog in a
// state with no working way out. See that block's own comment.

import {
  archiveConversation,
  backfillFromServer,
  listConversations,
  markLiveConversationReset,
  recordConversationActivity,
} from "./coach-history-store";
import { apiClient } from "./api-client";

const mockStore = new Map<string, string>();

/**
 * Makes `setItem` reject, the way AsyncStorage really does on Android when its
 * SQLite file is full ("database or disk is full") or the payload pushes past
 * `AsyncStorage_db_size_in_MB`. `healthyWrites` lets a test land the first N
 * writes and fail the rest, which is how the half-written case is reached
 * (`archiveConversation` writes the payload and then the index).
 * `mock`-prefixed so jest.mock's hoisting allows the factory to close over it.
 */
const mockWriteFailure: { current: Error | null; healthyWrites: number } = {
  current: null,
  healthyWrites: 0,
};
let mockWriteCount = 0;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    // Async on purpose, not `Promise.resolve` of a sync read: the interleaving
    // these tests exercise only exists because storage reads and writes are
    // separated by awaits.
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockWriteCount += 1;
      if (mockWriteFailure.current && mockWriteCount > mockWriteFailure.healthyWrites) {
        throw mockWriteFailure.current;
      }
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
  mockWriteFailure.current = null;
  mockWriteFailure.healthyWrites = 0;
  mockWriteCount = 0;
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

// The module header promises that "none of it throws on a storage failure".
// That was true of the read paths and false of every write path, and the write
// half is the one that mattered: `archiveConversation` is awaited by "New
// chat"'s confirm dialog on both the Coach and Voice screens, INSIDE a
// `newChatBusy` flag. A rejection escaping it skipped the reset, and a stuck
// `newChatBusy` makes ConfirmDialog completely unescapable — it neuters
// `onRequestClose` (Android hardware back), drops the backdrop's `onPress`,
// disables Cancel, and Button treats `loading` as disabled, so Confirm is
// dead too. The only way out of the app at that point is force-quitting it.
//
// Every assertion below is `.resolves`, never `.rejects`: the contract is that
// a full disk costs the user a history entry, never the app.
describe("write paths survive a storage failure", () => {
  const turns = [
    { role: "USER" as const, content: "How did this week go?" },
    { role: "ASSISTANT" as const, content: "You hit four of five sessions." },
  ];

  it("archiveConversation resolves when the archive payload cannot be written", async () => {
    mockWriteFailure.current = new Error("database or disk is full");

    await expect(archiveConversation("2026-W33", turns)).resolves.toEqual(expect.any(String));
  });

  it("archiveConversation resolves when only the index write fails", async () => {
    // The payload lands, the index update does not — the half-written case,
    // which the caller must also survive.
    mockWriteFailure.current = new Error("database or disk is full");
    mockWriteFailure.healthyWrites = 1;

    await expect(archiveConversation("2026-W33", turns)).resolves.toEqual(expect.any(String));
  });

  it("recordConversationActivity resolves when the index cannot be written", async () => {
    mockWriteFailure.current = new Error("database or disk is full");

    await expect(recordConversationActivity("2026-W33", "Message sent")).resolves.toBeUndefined();
  });

  it("markLiveConversationReset resolves when the index cannot be written", async () => {
    // Called immediately after the server-side clear succeeds. A rejection
    // here aborted the rest of confirmNewChat just as effectively.
    mockWriteFailure.current = new Error("database or disk is full");

    await expect(markLiveConversationReset("2026-W33")).resolves.toBeUndefined();
  });

  it("still returns a usable id, so a failed archive is invisible to the caller", async () => {
    mockWriteFailure.current = new Error("database or disk is full");

    const id = await archiveConversation("2026-W33", turns);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("leaves the list readable rather than half-broken after a failed write", async () => {
    await recordConversationActivity("2026-W31", "Recorded while storage was healthy");
    mockWriteFailure.current = new Error("database or disk is full");

    await archiveConversation("2026-W33", turns);
    mockWriteFailure.current = null;

    const scopeKeys = (await listConversations()).map((entry) => entry.scopeKey);
    expect(scopeKeys).toEqual(["2026-W31"]);
  });
});
