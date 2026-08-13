// Keeps the OS-scheduled "you haven't journaled today" nudge in sync with
// today's entry and the settings toggle. The reconciliation half of
// journal-reminders.ts, in the same shape useTimerReminders.ts has for the
// timer's check-in batch: the pure module decides WHAT is scheduled, this
// decides WHEN that reconciliation runs.
//
// WHY this is a self-contained hook (it runs its own `useQuery` for today's
// entry rather than accepting one as a prop) instead of a single sync
// component mounted once app-wide the way ScheduleRemindersSync is: that
// component lives in app/(app)/_layout.tsx, which this change deliberately
// does not touch (owned by concurrent work). Being self-contained is what
// lets `useJournalReminderSync()` be called from more than one screen
// (app/(app)/journal.tsx and app/(app)/notification-settings.tsx) and still
// only ever hit the network once — both calls share the same React Query
// cache entry (`journalQueries.byDate(today)`), so mounting it twice is a
// second subscriber, not a second request.
//
// Known gap from not having one app-wide mount point: reconciliation only
// runs while one of those two screens is actually focused, so a reminder
// that fires while the app is closed does not get tomorrow's occurrence
// re-armed until the user next opens Journal or Notification settings (or
// backgrounds/foregrounds the app while already on one of them — see the
// AppState listener below). That is the same tradeoff useTimerReminders.ts
// accepts for its batch running out mid-background; it is topped up on
// foreground rather than guaranteed to never run dry.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { todayKey } from "@goalslot/shared";

import { useCapabilities } from "@/providers/capabilities-provider";
import { reconcileJournalReminder } from "./journal-reminders";
import { journalQueries } from "./queries";
import { useSettingsStore } from "./settings-store";

/**
 * Arms or cancels the single pending journal reminder to match "is the
 * setting on" and "does today already have a saved entry".
 *
 * Deliberately does not accept a `blocks`/`entries` argument the way
 * useScheduleReminderSync does — a single scalar (today's content) is all
 * this ever needs, and fetching it internally is what makes the hook safe to
 * mount from more than one screen (see header comment).
 */
export function useJournalReminderSync(): void {
  const { notifications } = useCapabilities();
  const enabled = useSettingsStore((s) => s.journalReminderEnabled);
  const hour = useSettingsStore((s) => s.journalReminderHour);

  // Same pre-hydration guard useTimerReminders.ts documents, applied to the
  // settings store instead of the timer store: AsyncStorage-backed state
  // reports its INITIAL_STATE defaults for the first few frames of a cold
  // start. Acting on that would schedule (or cancel) against a stale
  // `enabled`/`hour` and then immediately redo the work once the real,
  // persisted values land a moment later — wasted work at best, and at worst
  // a user who turned the reminder off sees it flash back on for one pass.
  const hydrated = useSyncExternalStore(
    useSettingsStore.persist.onFinishHydration,
    useSettingsStore.persist.hasHydrated,
    useSettingsStore.persist.hasHydrated,
  );

  // Not memoized (unlike journal.tsx's own `today`, which is pinned for the
  // life of that screen): recomputing on every render is what lets a
  // date-rollover be picked up the moment this hook's component next
  // re-renders — which the AppState listener below forces on every
  // foreground, exactly when "is it still today" most needs rechecking.
  const today = todayKey();
  const entryQuery = useQuery(journalQueries.byDate(today));

  // Notification calls are async and this effect can re-fire faster than
  // they settle (toggling the setting right after entryQuery resolves).
  // Chaining every update onto the previous one guarantees they apply in the
  // order requested — same guard useTimerReminders.ts uses.
  const pending = useRef<Promise<void>>(Promise.resolve());
  const runQueued = useCallback((fn: () => Promise<void>) => {
    pending.current = pending.current.then(fn, fn);
  }, []);

  // Re-checks "is it still today, and has today been journaled" whenever the
  // app returns to the foreground — the only way a day boundary crossed
  // while backgrounded gets noticed without a fresh mount.
  const [foregroundCount, setForegroundCount] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setForegroundCount((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // `undefined` means the query hasn't resolved yet (a day with no entry
    // resolves to `null`, not undefined — see journalQueries.byDate). Acting
    // before it settles would schedule against "no content" and then
    // immediately have to cancel once the real entry turns out to have text,
    // which is a visible flash-then-cancel on a slow connection rather than
    // just waiting the extra moment.
    if (entryQuery.data === undefined) return;

    runQueued(async () => {
      try {
        const hasJournaledToday = (entryQuery.data?.content ?? "").trim().length > 0;
        await reconcileJournalReminder({ enabled, hourOfDay: hour, hasJournaledToday }, notifications);
      } catch (error) {
        // A missing reminder is a degraded nicety; it must never surface as
        // an error in the screen that happened to have this hook mounted.
        console.warn("[journal-reminders] could not reconcile journal reminder", error);
      }
    });
  }, [enabled, entryQuery.data, foregroundCount, hour, hydrated, notifications, runQueued]);
}
