// The single owner of "what the OS should currently have queued" for the
// combined due-today task digest. Replaces useTaskReminders.ts's
// per-task-per-due-date reminders entirely — see task-digest-reminders.ts's
// header for why. Mirrors useTaskReminderSync's serial-queue shape, plus
// useJournalReminderSync's own foreground-triggered re-check (see below for
// why this needs one and useTaskReminderSync didn't).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { todayKey, type Task } from "@goalslot/shared";

import { useCapabilities } from "@/providers/capabilities-provider";
import { useSettingsStore } from "./settings-store";
import { reconcileTaskDigestReminders } from "./task-digest-reminders";

/**
 * Serialises notification work so overlapping reconcile passes (e.g. a fast
 * refetch right after a task edit, or a setting change landing mid-flight)
 * can't race and leave the OS one step behind. Same guard
 * useTaskReminderSync and useJournalReminderSync use.
 */
function useSerialQueue() {
  const pending = useRef<Promise<void>>(Promise.resolve());
  return useCallback((fn: () => Promise<void>) => {
    pending.current = pending.current.then(fn, fn);
    return pending.current;
  }, []);
}

/**
 * Mount once, app-wide (see TaskRemindersSync.tsx), for the whole
 * authenticated session.
 */
export function useTaskDigestReminderSync(tasks: readonly Task[]): void {
  const { notifications } = useCapabilities();
  const runQueued = useSerialQueue();

  const enabled = useSettingsStore((s) => s.taskDigestEnabled);
  const hours = useSettingsStore((s) => s.taskDigestHours);

  // Same pre-hydration guard useJournalReminderSync documents: AsyncStorage-
  // backed state reports INITIAL_STATE's defaults for the first few frames
  // of a cold start. Reconciling against that would arm the default
  // 9am/1pm/6pm set and then immediately redo the work once the real,
  // persisted hours land a moment later.
  const hydrated = useSyncExternalStore(
    useSettingsStore.persist.onFinishHydration,
    useSettingsStore.persist.hasHydrated,
    useSettingsStore.persist.hasHydrated,
  );

  // `tasks` is a fresh array on every render (query data), so this keys off
  // what's actually in it. dueDate and status both matter: editing either
  // can move a task in or out of "due today" or silence it once DONE. Same
  // approach useTaskReminderSync used for the retired per-task feature.
  const tasksKey = tasks.map((t) => `${t.id}:${t.dueDate ?? ""}:${t.status}`).join("|");

  // Unlike the retired per-task reminders, this feature's output (the
  // digest COUNT and which of today's slots still lie ahead) can change
  // with nothing about `tasks` changing at all — purely because midnight
  // passed while the app was backgrounded. `tasksKey` alone would miss
  // that: the effect below only reruns when the task list's content
  // actually differs. Re-checking on every foreground (same trigger
  // useJournalReminderSync uses for its own "is it still today" concern)
  // is what catches the rollover.
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
        await reconcileTaskDigestReminders(
          { tasks, enabled, hours, todayStr: todayKey() },
          notifications,
        );
      } catch (error) {
        console.warn("[task-digest-reminders] could not reconcile digest reminders", error);
      }
    });
    // `tasks` is represented by tasksKey above; `foregroundCount` exists
    // purely to force a re-check on every foreground (see comment above).
  }, [tasksKey, enabled, hours, hydrated, foregroundCount, notifications, runQueued]);
}
