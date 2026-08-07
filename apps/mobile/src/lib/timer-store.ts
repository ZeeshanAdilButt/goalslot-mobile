// Session/UI state for the running timer. This is deliberately app-layer
// state, not cross-platform business logic — the web app's equivalent
// (use-timer-store.ts) never moved to packages/shared, and it shouldn't:
// "is a timer currently running on this device" isn't something the API or
// another platform needs to know about.
//
// Persisted via AsyncStorage (unlike the auth store, see
// src/providers/auth-provider.tsx's header comment) so a timer that's
// running when the app gets backgrounded-and-evicted or the device restarts
// is still "running" when the user comes back — this is non-sensitive
// session state, not a credential, so persisting it plainly is fine and
// matches the web app's own approach.
//
// Holds only timestamps, never a ticking value or an interval handle. A
// `setInterval` living *inside* this store would tick even while no screen
// is mounted to render it (wasted work across the whole app, not just this
// screen) and would need to be started/stopped in lockstep with every
// status transition. Instead the store only remembers *when* things
// happened; `getElapsedMs` below is a pure function of that state plus
// "now", and the timer screen re-invokes it on its own `setInterval` to
// animate the display. See timer.tsx for that loop.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type TimerStatus = "idle" | "running" | "paused";

interface TimerPersistedState {
  status: TimerStatus;
  /** Epoch ms when the current running segment began; null while paused/idle. */
  startedAt: number | null;
  /** Elapsed ms accumulated from segments before the current one (i.e. across pauses). */
  pausedElapsedMs: number;
  taskId: string | null;
  goalId: string | null;
}

interface TimerState extends TimerPersistedState {
  start: (taskId?: string, goalId?: string) => void;
  pause: () => void;
  resume: () => void;
  /** Stops the timer, resets to idle, and returns the total elapsed ms for the session that just ended. */
  stop: () => number;
}

const INITIAL_STATE: TimerPersistedState = {
  status: "idle",
  startedAt: null,
  pausedElapsedMs: 0,
  taskId: null,
  goalId: null,
};

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      start(taskId, goalId) {
        set({
          status: "running",
          startedAt: Date.now(),
          pausedElapsedMs: 0,
          taskId: taskId ?? null,
          goalId: goalId ?? null,
        });
      },

      pause() {
        const { status, startedAt, pausedElapsedMs } = get();
        if (status !== "running" || startedAt === null) return;
        set({
          status: "paused",
          startedAt: null,
          pausedElapsedMs: pausedElapsedMs + (Date.now() - startedAt),
        });
      },

      resume() {
        if (get().status !== "paused") return;
        set({ status: "running", startedAt: Date.now() });
      },

      stop() {
        const elapsedMs = getElapsedMs(get());
        set({ ...INITIAL_STATE });
        return elapsedMs;
      },
    }),
    {
      name: "goalslot-timer-store",
      storage: createJSONStorage(() => AsyncStorage),
      // Only the raw timer facts are worth persisting — the action
      // functions below aren't serializable and are rebuilt fresh on every
      // store creation anyway.
      partialize: (state) => ({
        status: state.status,
        startedAt: state.startedAt,
        pausedElapsedMs: state.pausedElapsedMs,
        taskId: state.taskId,
        goalId: state.goalId,
      }),
    },
  ),
);

/**
 * Pure function: elapsed ms for a given timer state, evaluated against the
 * current wall clock. Exported so callers can recompute it on their own
 * schedule (e.g. a `setInterval` in the screen) instead of this store
 * owning a ticking timer.
 *
 * Correct even when `startedAt` is from a much earlier app session — this
 * is just `now - startedAt`, however long ago "now" turns out to be, which
 * is exactly what lets a persisted running timer resume showing the right
 * elapsed time immediately after an app restart.
 */
export function getElapsedMs(
  state: Pick<TimerState, "status" | "startedAt" | "pausedElapsedMs">,
): number {
  if (state.status === "running" && state.startedAt !== null) {
    return state.pausedElapsedMs + Math.max(0, Date.now() - state.startedAt);
  }
  return state.pausedElapsedMs;
}
