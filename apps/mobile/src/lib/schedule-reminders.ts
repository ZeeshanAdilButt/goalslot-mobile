// Schedules and cancels the actual OS-level notification behind a schedule
// block's reminder. Pure functions over a NotificationCapability — no React,
// no store access — so the reconciliation hook (useScheduleReminders.ts)
// stays the only place that decides WHEN these run.

import { formatTime12h, type ScheduleBlock } from "@goalslot/shared";
import type { NotificationCapability } from "@goalslot/shared";

/** Stable per-block id so re-scheduling the same block replaces its entry rather than stacking a duplicate. */
export function reminderIdFor(block: ScheduleBlock): string {
  return `schedule-reminder-${block.id}`;
}

export async function scheduleBlockReminder(
  block: ScheduleBlock,
  notifications: NotificationCapability,
): Promise<void> {
  const [hour, minute] = block.startTime.split(":").map(Number);

  await notifications.scheduleNotification({
    id: reminderIdFor(block),
    title: block.title,
    body: `Starting now · ${formatTime12h(block.startTime)}`,
    repeat: { weekday: block.dayOfWeek, hour, minute },
    // Reuses the existing schedule-day route (deep-links.ts already resolves
    // this exact shape) rather than inventing a new notification-data case.
    data: { type: "schedule", dayOfWeek: block.dayOfWeek },
  });
}

export async function cancelBlockReminder(block: ScheduleBlock, notifications: NotificationCapability): Promise<void> {
  await notifications.cancelNotification(reminderIdFor(block));
}
