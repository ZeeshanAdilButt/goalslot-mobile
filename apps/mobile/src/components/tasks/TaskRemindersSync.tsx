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

import { useQuery } from "@tanstack/react-query";

import { taskQueries } from "@/lib/queries";
import { useTaskReminderSync } from "@/lib/useTaskReminders";

export function TaskRemindersSync(): null {
  const { data } = useQuery(taskQueries.list());

  useTaskReminderSync(data ?? []);
  return null;
}
