// Schedules and cancels the actual OS-level alarm behind a schedule block.
// Pure functions over a NotificationCapability — no React, no store access —
// so the reconciliation hook (useScheduleReminders.ts) stays the only place
// that decides WHEN these run.

import { formatTime12h, type ScheduleBlock } from "@goalslot/shared";
import type { NotificationCapability } from "@goalslot/shared";

import type { ReminderTier } from "./schedule-reminders-store";

/**
 * Namespace every schedule-block alarm shares. Used both to mint ids and, in
 * `pruneOrphanReminders`, to recognise our own entries in the OS queue
 * without touching the timer's (`goalslot-timer`) or anything else's.
 */
export const REMINDER_ID_PREFIX = "schedule-reminder-";

/** Stable per-block id so re-scheduling the same block replaces its entry rather than stacking a duplicate. */
export function reminderIdFor(block: Pick<ScheduleBlock, "id">): string {
  return `${REMINDER_ID_PREFIX}${block.id}`;
}

/**
 * Arms a block's reminder at the given tier. "off" is not this function's
 * job — a caller resolving "off" should call `cancelBlockReminder` instead,
 * same as `reconcileBlockReminders` does below.
 */
export async function scheduleBlockReminder(
  block: ScheduleBlock,
  notifications: NotificationCapability,
  tier: Exclude<ReminderTier, "off"> = "alarm",
): Promise<void> {
  const [hour, minute] = block.startTime.split(":").map(Number);

  await notifications.scheduleNotification({
    id: reminderIdFor(block),
    title: block.title,
    body: `Starting now · ${formatTime12h(block.startTime)}`,
    repeat: { weekday: block.dayOfWeek, hour, minute },
    // The whole point of the "alarm" tier: this must be audible and
    // interrupt, not settle quietly into the shade. See NotificationInput.alarm
    // and src/lib/notifications.ts for what this maps onto per platform.
    // "notify" is the gentler counterpart — audible, but not alarm-grade —
    // and the two are mutually exclusive on the wire, so only one is ever
    // set here.
    alarm: tier === "alarm" ? true : undefined,
    notify: tier === "notify" ? true : undefined,
    // Reuses the existing schedule-day route (deep-links.ts already resolves
    // this exact shape) rather than inventing a new notification-data case.
    data: { type: "schedule", dayOfWeek: block.dayOfWeek },
  });
}

export async function cancelBlockReminder(
  block: Pick<ScheduleBlock, "id">,
  notifications: NotificationCapability,
): Promise<void> {
  await notifications.cancelNotification(reminderIdFor(block));
}

/**
 * Brings the OS's queue in line with what the store says, for every block
 * given. Blocks resolving to "notify" or "alarm" are (re)scheduled at that
 * tier; "off" blocks are cancelled.
 *
 * The cancel half is not optional bookkeeping — it is the difference between
 * a switch that works and one that lies. Notifications already handed to the
 * OS fire whether or not this app agrees with them any more, so a toggle that
 * only stopped FUTURE scheduling would leave the user's phone still going off
 * every week at 6am for a series they explicitly silenced.
 *
 * One block failing must never abort the rest of the week, hence the per-item
 * guard: a single bad id would otherwise leave every block after it in the
 * loop unreconciled.
 */
export async function reconcileBlockReminders(
  blocks: readonly ScheduleBlock[],
  tierFor: (block: ScheduleBlock) => ReminderTier,
  notifications: NotificationCapability,
): Promise<void> {
  for (const block of blocks) {
    try {
      const tier = tierFor(block);
      if (tier === "off") {
        await cancelBlockReminder(block, notifications);
      } else {
        await scheduleBlockReminder(block, notifications, tier);
      }
    } catch (error) {
      console.warn(`[schedule-reminders] could not reconcile reminder for block ${block.id}`, error);
    }
  }
}

/** Cancels every given block's alarm, whatever the store currently says. */
export async function cancelBlockReminders(
  blocks: readonly Pick<ScheduleBlock, "id">[],
  notifications: NotificationCapability,
): Promise<void> {
  for (const block of blocks) {
    try {
      await cancelBlockReminder(block, notifications);
    } catch (error) {
      console.warn(`[schedule-reminders] could not cancel reminder for block ${block.id}`, error);
    }
  }
}

/**
 * Cancels queued schedule alarms whose block no longer exists.
 *
 * WHY this is needed at all: these alarms repeat weekly and forever, and the
 * OS keeps them whether or not the block that named them still exists.
 * Delete a block on the web, or from another device, or (until this change)
 * from this app at all, and the phone keeps announcing "Reading" every
 * Tuesday at 6am for a slot that was removed months ago. Reconciliation
 * alone can never catch that: it iterates over the blocks that DO exist, and
 * an orphan is by definition absent from that list.
 *
 * Scoped by `REMINDER_ID_PREFIX`, so the timer's ongoing entry and any future
 * notification family are left strictly alone — this must not become a
 * second `clearAllNotifications`.
 */
export async function pruneOrphanReminders(
  blocks: readonly Pick<ScheduleBlock, "id">[],
  notifications: NotificationCapability,
): Promise<void> {
  let queuedIds: string[];
  try {
    queuedIds = await notifications.listScheduledIds();
  } catch (error) {
    console.warn("[schedule-reminders] could not list queued reminders to prune", error);
    return;
  }

  const expected = new Set(blocks.map((block) => reminderIdFor(block)));
  const orphans = queuedIds.filter((id) => id.startsWith(REMINDER_ID_PREFIX) && !expected.has(id));

  for (const id of orphans) {
    try {
      await notifications.cancelNotification(id);
    } catch (error) {
      console.warn(`[schedule-reminders] could not cancel orphaned reminder ${id}`, error);
    }
  }
}
