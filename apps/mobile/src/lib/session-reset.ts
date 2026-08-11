// Wipes every trace of the signed-in account from the device.
//
// WHY this exists: signing out used to clear the auth tokens and nothing
// else — "when I logged in from a different user I could see data of old
// people". Tokens are only the key to the door; the previous account's data
// was still sitting in the caches behind it, and the next person to sign in
// on the device saw it.
//
// Four separate things outlive a logout, and all of them are per-account:
//
//   1. The React Query cache. Persisted to AsyncStorage with a 7-day gcTime
//      (query-client.ts), so it survives not just logout but app restarts.
//      This is the one that actually showed another person's goals and
//      tasks: on the next sign-in the screens mount, find cached data, and
//      render it with `isPending: false` — no skeleton, no hint it's stale —
//      until a refetch happens to replace it.
//   2. The offline outbox. Entries are plain payloads with no record of who
//      queued them, replayed against whatever credentials are current, so a
//      create queued by one account would land in the next account's data.
//      Worse than a stale read: it writes.
//   3. The timer store. A running timer would carry over mid-session and,
//      on stop, log its hours against the new account.
//   4. Per-account UI state keyed by server ids — which schedule blocks have
//      reminders switched off, which notes are expanded. Meaningless ids
//      under a different account, and quietly wrong if any collide.
//
// Called on sign-OUT and again on sign-IN. The sign-in call is not
// redundant: a process kill (or a crash) between the two skips the sign-out
// path entirely, and the reset has to be guaranteed before new data is
// fetched, not merely attempted on the way out.

import { outbox } from "./offline";
import { asyncStoragePersister, queryClient } from "./query-client";
import { useNotesUiStore } from "./notes-ui-store";
import { useScheduleRemindersStore } from "./schedule-reminders-store";
import { useTimerStore } from "./timer-store";

/**
 * Every step is individually guarded. A failure in one store must not leave
 * the others populated — a partial reset is how you end up leaking exactly
 * the one cache that threw.
 */
async function step(label: string, run: () => unknown): Promise<void> {
  try {
    // `unknown` rather than `void | Promise<void>`: the calls below return a
    // grab-bag (the persister's PromiseLike, the timer's elapsed-ms number),
    // and none of those return values mean anything here — awaiting a
    // non-thenable is a no-op, so this handles both shapes without each
    // caller needing a wrapper.
    await run();
  } catch (error) {
    console.warn(`[session-reset] failed to clear ${label}`, error);
  }
}

export async function resetSessionState(): Promise<void> {
  // In-memory first, so nothing can re-render with stale data while the
  // slower AsyncStorage writes below are still settling.
  await step("query cache", () => queryClient.clear());

  // `clear()` empties the cache but does not touch what was already written
  // to disk; without this the next launch rehydrates the old account's data
  // straight back in.
  await step("persisted query cache", () => asyncStoragePersister.removeClient());

  await step("offline outbox", () => outbox.clearOutbox());
  await step("timer", () => useTimerStore.getState().stop());
  await step("schedule reminders", () => useScheduleRemindersStore.getState().reset());
  await step("notes ui state", () => useNotesUiStore.getState().reset());
}
