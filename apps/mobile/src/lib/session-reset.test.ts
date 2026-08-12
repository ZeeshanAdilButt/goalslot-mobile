// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see notifications.test.ts and derive-online.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
//
// Everything session-reset.ts touches is a module-level singleton — a
// zustand store, a QueryClient, the outbox — so the seam worth testing is
// which of them it calls and in what order, not their internals (each has
// its own tests). Hence module mocks rather than real stores.
import { resetSessionState } from "./session-reset";

// Jest's module-factory hoisting only allows a jest.mock() factory to close
// over out-of-scope variables whose names start with "mock" — see the same
// note in notifications.test.ts.
const mockOrder: string[] = [];
const record = (label: string) => () => {
  mockOrder.push(label);
};

const mockQueryClientClear = jest.fn(record("query cache"));
const mockRemoveClient = jest.fn(record("persisted query cache"));
const mockClearOutbox = jest.fn(record("outbox"));
const mockTimerStop = jest.fn(record("timer"));
const mockScheduleRemindersReset = jest.fn(record("schedule reminders store"));
const mockNotesUiReset = jest.fn(record("notes ui"));
const mockClearAllNotifications = jest.fn(record("notifications"));

jest.mock("./query-client", () => ({
  queryClient: { clear: (...args: unknown[]) => mockQueryClientClear(...args) },
  asyncStoragePersister: { removeClient: (...args: unknown[]) => mockRemoveClient(...args) },
}));

jest.mock("./offline", () => ({
  outbox: { clearOutbox: (...args: unknown[]) => mockClearOutbox(...args) },
}));

jest.mock("./timer-store", () => ({
  useTimerStore: { getState: () => ({ stop: (...args: unknown[]) => mockTimerStop(...args) }) },
}));

jest.mock("./schedule-reminders-store", () => ({
  useScheduleRemindersStore: {
    getState: () => ({ reset: (...args: unknown[]) => mockScheduleRemindersReset(...args) }),
  },
}));

jest.mock("./notes-ui-store", () => ({
  useNotesUiStore: { getState: () => ({ reset: (...args: unknown[]) => mockNotesUiReset(...args) }) },
}));

jest.mock("./notifications", () => ({
  createExpoNotificationCapability: () => ({
    clearAllNotifications: (...args: unknown[]) => mockClearAllNotifications(...args),
  }),
}));

describe("resetSessionState", () => {
  beforeEach(() => {
    mockOrder.length = 0;
    for (const fn of [
      mockQueryClientClear,
      mockRemoveClient,
      mockClearOutbox,
      mockTimerStop,
      mockScheduleRemindersReset,
      mockNotesUiReset,
      mockClearAllNotifications,
    ]) {
      fn.mockClear();
    }
  });

  it("clears every per-account cache on the device", async () => {
    await resetSessionState();

    expect(mockQueryClientClear).toHaveBeenCalled();
    expect(mockRemoveClient).toHaveBeenCalled();
    expect(mockClearOutbox).toHaveBeenCalled();
    expect(mockTimerStop).toHaveBeenCalled();
    expect(mockScheduleRemindersReset).toHaveBeenCalled();
    expect(mockNotesUiReset).toHaveBeenCalled();
  });

  // The privacy bug this file was extended for: a schedule-block reminder is
  // titled with the block's own name and repeats weekly, indefinitely. Left
  // queued, it keeps announcing the previous account's private schedule to
  // whoever is holding the device.
  it("drops the notifications the OS is still holding for the outgoing account", async () => {
    await resetSessionState();

    expect(mockClearAllNotifications).toHaveBeenCalledTimes(1);
  });

  it("sweeps the OS queue only after the stores are empty", async () => {
    // A screen still mounted during sign-out reconciles its reminders off the
    // query cache. Sweeping first would race that reconcile and let it
    // re-queue what was just cancelled; sweeping last means it has already
    // re-rendered down to an empty block list.
    await resetSessionState();

    expect(mockOrder[mockOrder.length - 1]).toBe("notifications");
    expect(mockOrder.indexOf("query cache")).toBeLessThan(mockOrder.indexOf("notifications"));
  });

  it("completes the sign-out even when clearing notifications fails", async () => {
    // Permission never granted, native module missing, OS refusing — none of
    // it may strand a user in a signed-in session they asked to leave.
    mockClearAllNotifications.mockImplementationOnce(() => {
      throw new Error("native module unavailable");
    });

    await expect(resetSessionState()).resolves.toBeUndefined();
  });

  it("completes the sign-out when clearing notifications rejects asynchronously", async () => {
    mockClearAllNotifications.mockRejectedValueOnce(new Error("native module unavailable"));

    await expect(resetSessionState()).resolves.toBeUndefined();
  });

  it("still sweeps the OS queue when an earlier step blows up", async () => {
    // The sweep is last, so a throw anywhere above it is exactly the case
    // that would silently skip it if the steps weren't individually guarded.
    mockQueryClientClear.mockImplementationOnce(() => {
      throw new Error("cache is wedged");
    });

    await expect(resetSessionState()).resolves.toBeUndefined();
    expect(mockClearAllNotifications).toHaveBeenCalled();
  });
});
