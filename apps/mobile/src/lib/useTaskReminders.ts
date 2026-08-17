// The single owner of "what the OS should currently have queued" for
// task-due-date reminders. Mirrors useScheduleReminderSync in
// useScheduleReminders.ts, minus the tier-setting actions half — tasks have
// no per-task reminder tier to toggle, this is always-on for any task with a
// due date (see task-reminders.ts's header for why).

import { useCallback, useEffect, useRef } from "react";

import type { Task } from "@goalslot/shared";

import { useCapabilities } from "@/providers/capabilities-provider";
import { pruneOrphanTaskReminders, reconcileTaskReminders } from "./task-reminders";

/**
 * Serialises notification work so overlapping reconcile passes (e.g. a fast
 * refetch right after a task edit) can't race and leave the OS one step
 * behind. Same guard useScheduleReminders.ts and useTimerNotification.ts use.
 */
function useSerialQueue() {
  const pending = useRef<Promise<void>>(Promise.resolve());
  return useCallback((fn: () => Promise<void>) => {
    pending.current = pending.current.then(fn, fn);
    return pending.current;
  }, []);
}

/**
 * Mount once, app-wide, for the whole authenticated session — see
 * TaskRemindersSync.tsx for why this must not depend on the Tasks tab being
 * open (sign-in wipes the OS notification queue; edits can also come from
 * the Coach or another device).
 */
export function useTaskReminderSync(tasks: readonly Task[]): void {
  const { notifications } = useCapabilities();
  const runQueued = useSerialQueue();

  // `tasks` is a fresh array on every render (query data), so this keys off
  // what's actually in it. dueDate and status both matter: editing either
  // has to re-arm (new date) or cancel (marked done) the reminder, and an
  // id-only key would miss both.
  const tasksKey = tasks.map((t) => `${t.id}:${t.dueDate ?? ""}:${t.status}`).join("|");

  useEffect(() => {
    void runQueued(async () => {
      await reconcileTaskReminders(tasks, notifications);
      // Only meaningful once there is a real task list to diff against: with
      // `tasks` still empty (first paint, before the query resolves) every
      // queued reminder looks like an orphan, and pruning then would cancel
      // every pending task reminder on cold start.
      if (tasks.length > 0) await pruneOrphanTaskReminders(tasks, notifications);
    });
    // `tasks` is represented by tasksKey above.
  }, [tasksKey, notifications, runQueued]);
}
