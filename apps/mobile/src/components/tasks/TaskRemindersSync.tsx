// Arms every task-due-date reminder for the whole authenticated session,
// independent of which screen is open. Mirrors ScheduleRemindersSync.tsx
// exactly, for the exact same reasons:
//
//   1. Sign-in. session-reset.ts calls `clearAllNotifications()` on sign-IN
//      as well as sign-out, so every reminder is wiped on a perfectly normal
//      login. Without this mounted app-wide, nothing re-arms task reminders
//      until the user happens to open the Tasks tab.
//   2. Edits made elsewhere. A task with a due date created by the Coach
//      ("remind me to clean the kitchen in one week"), from QuickAdd, or
//      synced from another device only gets a reminder on the next visit to
//      Tasks otherwise. Mounting this once covers all of those for free —
//      see task-reminders.ts's header for why this is an app-wide feature
//      rather than something wired into the Coach's apply path specifically.
//
// It renders nothing. The query it reads is the same cached
// `taskQueries.list()` the Tasks screen already subscribes to (unfiltered —
// every task, not just one status column), so this adds a subscriber, not a
// request.

import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { taskQueries } from "@/lib/queries";
import { useTaskReminderSync } from "@/lib/useTaskReminders";

export function TaskRemindersSync(): null {
  const { data } = useQuery(taskQueries.list());

  useTaskReminderSync(data ?? []);

  // Foreground refetch — same trigger/shape as the bell-badge and widget-sync
  // AppState listener in app/(app)/_layout.tsx. Without this, a due-date
  // change (or completion/delete) made on another device, from the Coach, or
  // from QuickAdd only reaches THIS device's already-scheduled OS
  // notification once this query happens to refetch on its own — up to
  // staleTime later, or not at all if the app is only ever foregrounded
  // briefly and backgrounded again before that. Invalidating here forces an
  // immediate refetch every time the app comes to the foreground;
  // useTaskReminderSync's own effect (keyed on each task's id/dueDate/status)
  // then reconciles the moment the fresh data lands, so this only has to
  // trigger the refetch — not repeat the reconciliation itself. Reconciling
  // with the stale, already-cached data instead of refetching first would be
  // a no-op: it's exactly the same data the OS reminder was already scheduled
  // against.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.list() });
      }
    });
    return () => subscription.remove();
  }, []);

  return null;
}
