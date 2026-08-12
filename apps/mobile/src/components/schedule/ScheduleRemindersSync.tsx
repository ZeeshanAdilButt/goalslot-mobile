// Arms the week's schedule alarms for the whole authenticated session,
// independent of which screen is open.
//
// WHY this is mounted in app/(app)/_layout.tsx rather than on the Schedule
// screen. Reconciliation used to be a side effect of the Schedule screen's
// own hook, so the OS queue was only ever brought up to date while that one
// tab was mounted. Two things then quietly break:
//
//   1. Sign-in. session-reset.ts calls `clearAllNotifications()` on sign-IN
//      as well as sign-out — on purpose, because a process kill between the
//      two skips the sign-out path entirely and the previous account's
//      reminders would otherwise survive. The cost was that every alarm was
//      wiped on a perfectly normal login and nothing re-armed them until the
//      user happened to visit Schedule. Sign in, go to Today, never open the
//      Schedule tab: no alarms, and nothing anywhere says so.
//   2. Edits made elsewhere. A block created by QuickAdd from Today, or a
//      change synced from the web app, only got an alarm on the next visit
//      to Schedule.
//
// It renders nothing. The query it reads is the same cached
// `scheduleQueries.weekly()` the Today and Schedule screens already
// subscribe to, so this adds a subscriber, not a request.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { scheduleQueries } from "@/lib/queries";
import { useScheduleReminderSync } from "@/lib/useScheduleReminders";

export function ScheduleRemindersSync(): null {
  const { data } = useQuery(scheduleQueries.weekly());

  // Every block across the whole week, not just one day — alarms cover "all
  // schedule blocks", and a day the user never opens still has to ring.
  const allBlocks = useMemo(() => Object.values(data ?? {}).flat(), [data]);

  useScheduleReminderSync(allBlocks);
  return null;
}
