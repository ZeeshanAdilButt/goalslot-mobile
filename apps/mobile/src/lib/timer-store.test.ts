// No import of `describe`/`it`/`expect`/`jest`: same convention as
// timer-reminders.test.ts and settings-store.test.ts — Jest injects these as
// real globals, and this file is excluded from `tsc --noEmit` via
// tsconfig.json's `exclude`.
//
// `getElapsedMs` being genuinely PURE — safe to call without resetting or
// otherwise touching the store — is what app/(app)/timer.tsx's stop flow now
// depends on: it snapshots the elapsed time this way before knowing whether
// the save will succeed, specifically so a failed save (most commonly a
// free-plan user past today's entry cap) never has to have already reset the
// store to get that number. See timer.test.ts's "handleStop" suite for the
// screen-level behaviour this pure fact makes possible.

import { getElapsedMs, useTimerStore } from "./timer-store";

// The store module imports AsyncStorage at load time for its persist
// middleware. Nothing here exercises persistence itself (that would mean
// asserting against the native module's call log, which is what
// session-reset.test.ts already covers for the equivalent auth-store
// concern) — only the in-memory actions and the pure elapsed-time function,
// so the native module is stubbed rather than installed.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const IDLE = { status: "idle" as const, startedAt: null, pausedElapsedMs: 0, taskId: null, goalId: null };

beforeEach(() => {
  useTimerStore.setState({ ...IDLE });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("start", () => {
  it("begins a running session at zero elapsed with the given attribution", () => {
    useTimerStore.getState().start("task-1", "goal-1");

    const state = useTimerStore.getState();
    expect(state.status).toBe("running");
    expect(state.taskId).toBe("task-1");
    expect(state.goalId).toBe("goal-1");
    expect(state.pausedElapsedMs).toBe(0);
    expect(state.startedAt).not.toBeNull();
  });

  it("starts unattributed when called with no arguments — the one-tap case", () => {
    useTimerStore.getState().start();

    const state = useTimerStore.getState();
    expect(state.status).toBe("running");
    expect(state.taskId).toBeNull();
    expect(state.goalId).toBeNull();
  });
});

describe("pause/resume", () => {
  it("pause banks the open segment into pausedElapsedMs and clears startedAt", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start();
    jest.setSystemTime(4000);

    useTimerStore.getState().pause();

    const state = useTimerStore.getState();
    expect(state.status).toBe("paused");
    expect(state.startedAt).toBeNull();
    expect(state.pausedElapsedMs).toBe(4000);
  });

  it("resume opens a fresh segment without disturbing the banked total", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start();
    jest.setSystemTime(4000);
    useTimerStore.getState().pause();

    jest.setSystemTime(10_000);
    useTimerStore.getState().resume();

    const state = useTimerStore.getState();
    expect(state.status).toBe("running");
    expect(state.startedAt).toBe(10_000);
    expect(state.pausedElapsedMs).toBe(4000);
  });

  it("pause is a no-op while idle", () => {
    useTimerStore.getState().pause();
    expect(useTimerStore.getState()).toMatchObject(IDLE);
  });
});

describe("stop", () => {
  it("resets to idle and returns the total elapsed ms", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start("task-1", "goal-1");
    jest.setSystemTime(5000);

    const elapsed = useTimerStore.getState().stop();

    expect(elapsed).toBe(5000);
    expect(useTimerStore.getState()).toMatchObject(IDLE);
  });

  it("sums banked and open time across a pause/resume cycle", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start();
    jest.setSystemTime(3000);
    useTimerStore.getState().pause(); // banks 3000

    jest.setSystemTime(8000);
    useTimerStore.getState().resume(); // opens a new segment at 8000
    jest.setSystemTime(9500); // 1500ms into the new segment

    expect(useTimerStore.getState().stop()).toBe(4500);
  });
});

describe("getElapsedMs", () => {
  it("is a pure read — it never mutates the store", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start();
    jest.setSystemTime(3000);

    const snapshot = useTimerStore.getState();
    const first = getElapsedMs(snapshot);
    const second = getElapsedMs(snapshot);

    expect(first).toBe(3000);
    expect(second).toBe(3000);
    // Calling it — even twice — must not have reset anything. This is the
    // exact property timer.tsx's handleStop relies on: it can compute the
    // elapsed time BEFORE attempting the save, and if the save then fails,
    // the store is still sitting here untouched, still running.
    expect(useTimerStore.getState().status).toBe("running");
    expect(useTimerStore.getState().startedAt).toBe(0);
  });

  it("matches what stop() reports for the same instant", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start();
    jest.setSystemTime(7000);

    const viaGetElapsedMs = getElapsedMs(useTimerStore.getState());
    const viaStop = useTimerStore.getState().stop();

    expect(viaGetElapsedMs).toBe(viaStop);
  });

  it("reflects only the banked total while paused, ignoring the wall clock", () => {
    jest.useFakeTimers().setSystemTime(0);
    useTimerStore.getState().start();
    jest.setSystemTime(2000);
    useTimerStore.getState().pause();

    jest.setSystemTime(60_000); // time keeps moving; the paused session must not

    expect(getElapsedMs(useTimerStore.getState())).toBe(2000);
  });
});
