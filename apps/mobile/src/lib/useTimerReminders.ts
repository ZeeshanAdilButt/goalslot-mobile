// Keeps the OS-scheduled "are you still tracking?" batch in sync with the
// running timer. The reconciliation half of timer-reminders.ts, in the same
// shape useScheduleReminders.ts has for schedule blocks: the pure module
// decides WHAT is scheduled, this decides WHEN that reconciliation runs.
//
// Everything reaches the OS through useCapabilities().notifications, so
// permission handling comes for free and behaves exactly as it does for
// schedule reminders: src/lib/notifications.ts asks inline the first time,
// never re-prompts a user who has already refused, and silently no-ops when
// permission is denied. A refused permission therefore costs the user
// reminders and nothing else — the timer itself is untouched.
//
// This is deliberately separate from components/timer/useTimerNotification.ts
// even though both put timer state in the notification shade. That hook owns
// a single ONGOING entry — presented immediately, sticky, dismissed rather
// than cancelled, and (per its own header) unable to go through the
// capability port at all. These are future-dated, cancellable, one-shot
// notifications, which is precisely the shape NotificationCapability already
// models. Folding them together would mean re-implementing the port's
// permission handling by hand inside a file that has to bypass it.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { useCapabilities } from "@/providers/capabilities-provider";
import { useSettingsStore } from "./settings-store";
import { cancelTimerReminders, scheduleTimerReminders } from "./timer-reminders";
import { useTimerStore, type TimerStatus } from "./timer-store";

export interface UseTimerRemindersArgs {
  status: TimerStatus;
  /** Epoch ms the current running segment began; null while paused/idle. */
  startedAt: number | null;
  /**
   * Task or goal title being tracked. Null means there is no title to show:
   * either the session was deliberately started with nothing attached (the
   * Time Tracker allows this) or a target is set but hasn't resolved yet.
   * Both are handled the same way — see describeTimerReminder.
   */
  label: string | null;
}

export function useTimerReminders({ status, startedAt, label }: UseTimerRemindersArgs): void {
  const { notifications } = useCapabilities();
  const intervalMinutes = useSettingsStore((s) => s.timerReminderIntervalMinutes);

  // Same pre-hydration guard useTimerNotification.ts documents: the timer
  // store reads through AsyncStorage, so it reports "idle" for the first few
  // frames of a cold start regardless of what is actually running. Acting on
  // that would cancel a live session's whole batch and then re-issue it a
  // moment later — harmless in isolation, but it would also mean a reminder
  // due inside that window never fires.
  const hydrated = useSyncExternalStore(
    useTimerStore.persist.onFinishHydration,
    useTimerStore.persist.hasHydrated,
    useTimerStore.persist.hasHydrated,
  );

  // Notification calls are async and this effect can re-fire faster than they
  // settle (start -> pause in quick succession). Chaining every update onto
  // the previous one guarantees they apply in the order requested, so a stale
  // schedule can never land after a cancel.
  const pending = useRef<Promise<void>>(Promise.resolve());
  const runQueued = useCallback((fn: () => Promise<void>) => {
    pending.current = pending.current.then(fn, fn);
  }, []);

  // Tops the batch back up whenever the app returns to the foreground.
  // MAX_PENDING_TIMER_REMINDERS is a finite lookahead (see timer-reminders.ts),
  // and nothing else in this hook's dependencies changes while the app is
  // suspended — without this, a long session would run out of queued
  // reminders and stay silent. Because the fire times are anchored to
  // `startedAt`, this re-issue is a no-op for the reminders that are still
  // pending and only extends the tail.
  const [foregroundCount, setForegroundCount] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setForegroundCount((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    runQueued(async () => {
      try {
        // Reminders track RUNNING only, matching web: `if (timerState !==
        // 'RUNNING') return` clears its interval on both pause and stop, and
        // resume restarts the countdown from zero. Anchoring to `startedAt`
        // reproduces that for free — timer-store's resume() sets a fresh
        // `startedAt`, so the next reminder is a full interval after the
        // resume, not a leftover from before the pause.
        if (status !== "running" || startedAt === null) {
          await cancelTimerReminders(notifications);
          return;
        }
        await scheduleTimerReminders({ anchorMs: startedAt, intervalMinutes, label }, notifications);
      } catch (error) {
        // A missing reminder is a degraded nicety; the timer keeps its own
        // state and must never fail because the OS refused a notification.
        console.warn("[timer-reminders] could not reconcile tracking reminders", error);
      }
    });
  }, [foregroundCount, hydrated, intervalMinutes, label, notifications, runQueued, startedAt, status]);
}
