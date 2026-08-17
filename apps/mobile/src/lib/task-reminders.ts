// Schedules and cancels the actual OS-level local reminder for a task's due
// date. Pure functions over a NotificationCapability — no React, no store
// access — same shape as schedule-reminders.ts and journal-reminders.ts, so
// the reconciliation hook (useTaskReminders.ts) stays the only place that
// decides WHEN these run.
//
// This is an APP-WIDE feature, not Coach-specific: any task with a dueDate
// gets a reminder, whether it was created by the Coach ("remind me to X in
// one week") or typed directly into EditTaskSheet. Neither call site needs
// its own reminder logic — mounting TaskRemindersSync once for the whole
// authenticated session (see that component) covers both for free.
//
// WHY one-shot (fireAtUtc), not a repeating trigger: a task reminder fires
// once, ever, for a given due date. Same reasoning as journal-reminders.ts's
// header comment — a repeating OS trigger has no per-occurrence cancel, and
// a task that gets completed, has its due date moved, or is deleted needs
// its reminder gone or re-armed at the new date, not silenced forever on
// whatever weekday it originally landed on.
//
// WHY 9:00 AM local on the due date, a single fixed default rather than
// something user-configurable: Task.dueDate is a calendar day with no
// time-of-day component (see components/tasks/due-date.ts's header — the API
// stores it as UTC midnight built from a bare "YYYY-MM-DD", and tasks have
// no "scheduled time" field the way schedule blocks have startTime). A fixed
// default hour, morning-of, mirrors DEFAULT_JOURNAL_REMINDER_HOUR in
// journal-reminders.ts exactly rather than inventing a new shape for
// something with even less basis for a per-item time than a journal nudge
// has.

import type { NotificationCapability, Task, TaskStatus } from "@goalslot/shared";

import { parseDateKey } from "@/components/ui/calendar-math";
import { toDueDateKey } from "@/components/tasks/due-date";

/**
 * Namespace every task-due-date reminder shares. Used both to mint ids and,
 * in `pruneOrphanTaskReminders`, to recognise our own entries in the OS
 * queue without touching the schedule/timer/journal families sharing the
 * same queue.
 */
export const TASK_REMINDER_ID_PREFIX = "task-reminder-";

/** Stable per-task id so re-scheduling the same task replaces its entry rather than stacking a duplicate. */
export function reminderIdFor(task: Pick<Task, "id">): string {
  return `${TASK_REMINDER_ID_PREFIX}${task.id}`;
}

/** 9am — morning-of, while there is still a full day left to act on the task. */
export const DEFAULT_TASK_REMINDER_HOUR = 9;

/**
 * A reminder is only meaningful for a task that (a) actually has a readable
 * due date and (b) is not already done — a completed task has nothing left
 * to be reminded about. Shared by `reconcileTaskReminders` (decides arm vs.
 * cancel) and `pruneOrphanTaskReminders` (decides what counts as "expected"
 * rather than orphaned), so the two can never disagree about which tasks
 * should currently have a live reminder.
 */
export function isTaskReminderEligible(
  task: Pick<Task, "dueDate"> & { status: TaskStatus },
): boolean {
  return task.status !== "DONE" && toDueDateKey(task.dueDate) !== null;
}

/**
 * How many minutes ahead of "now" a same-day reminder is clamped to when the
 * task's normal 9am (or configured hour) slot has already passed. Long
 * enough that the notification doesn't feel instantaneous/glitchy, short
 * enough that "remind me to call the bank today" at 2pm still gets a
 * reminder today rather than silently getting nothing.
 */
const SAME_DAY_CLAMP_MINUTES = 5;

/**
 * The epoch ms this task's reminder should fire at: `hourOfDay:00` local
 * time on the due date. If that instant has already passed relative to
 * `nowMs` — the task is due today and it's already past the hour, or the due
 * date is in the past — clamp to a few minutes from now instead of silently
 * never firing. A same-day due date created at 2pm must still get a
 * reminder, not nothing; the alternative (skip it) is a worse failure mode
 * than firing a few minutes later than the "ideal" morning slot.
 */
export function taskReminderFireTime(args: {
  dueDateKey: string;
  hourOfDay?: number;
  nowMs?: number;
}): number {
  const { year, month, day } = parseDateKey(args.dueDateKey);
  const hourOfDay = args.hourOfDay ?? DEFAULT_TASK_REMINDER_HOUR;
  const nowMs = args.nowMs ?? Date.now();
  const candidate = new Date(year, month, day, hourOfDay, 0, 0, 0);
  if (candidate.getTime() <= nowMs) {
    return nowMs + SAME_DAY_CLAMP_MINUTES * 60 * 1000;
  }
  return candidate.getTime();
}

/** The notification copy. Deliberately generic ("Due today") rather than restating the due date — the title already carries the task name. */
export function describeTaskReminder(task: Pick<Task, "title">): {
  title: string;
  body: string;
} {
  return { title: task.title, body: "Due today" };
}

/**
 * Arms a task's reminder. No-ops (does not throw, does not schedule
 * anything) when the task has no readable due date — callers that want the
 * "cancel if ineligible" half should go through `reconcileTaskReminders`
 * instead of calling this directly.
 */
export async function scheduleTaskReminder(
  task: Task,
  notifications: NotificationCapability,
  opts: { hourOfDay?: number; nowMs?: number } = {},
): Promise<void> {
  const dueDateKey = toDueDateKey(task.dueDate);
  if (!dueDateKey) return;

  const fireAt = taskReminderFireTime({
    dueDateKey,
    hourOfDay: opts.hourOfDay,
    nowMs: opts.nowMs,
  });
  const { title, body } = describeTaskReminder(task);

  await notifications.scheduleNotification({
    id: reminderIdFor(task),
    title,
    body,
    fireAtUtc: new Date(fireAt).toISOString(),
    // Reuses the existing task deep link (deep-links.ts's DeepLinkNotificationData
    // already resolves this exact shape) rather than inventing a new case.
    data: { type: "task", id: task.id },
  });
}

export async function cancelTaskReminder(
  task: Pick<Task, "id">,
  notifications: NotificationCapability,
): Promise<void> {
  await notifications.cancelNotification(reminderIdFor(task));
}

/**
 * Brings the OS's queue in line with the given tasks: every eligible task
 * (see `isTaskReminderEligible`) is (re)armed, everything else — no due
 * date, or already DONE — is cancelled. The cancel half matters as much as
 * the arm half: completing a task or clearing its due date must actually
 * silence the reminder, not just stop scheduling future ones.
 *
 * One task failing must never abort the rest of the list, hence the
 * per-item guard — same reasoning as reconcileBlockReminders.
 */
export async function reconcileTaskReminders(
  tasks: readonly Task[],
  notifications: NotificationCapability,
  opts: { hourOfDay?: number; nowMs?: number } = {},
): Promise<void> {
  for (const task of tasks) {
    try {
      if (isTaskReminderEligible(task)) {
        await scheduleTaskReminder(task, notifications, opts);
      } else {
        await cancelTaskReminder(task, notifications);
      }
    } catch (error) {
      console.warn(`[task-reminders] could not reconcile reminder for task ${task.id}`, error);
    }
  }
}

/**
 * Cancels queued task reminders whose task no longer exists at all (deleted,
 * not just completed — a completed task is still IN the list and is handled
 * by reconcileTaskReminders' cancel branch above). Reconciliation alone can
 * never catch a deletion: it iterates over tasks that DO exist, and an
 * orphan is by definition absent from that list. Mirrors
 * pruneOrphanReminders in schedule-reminders.ts exactly.
 *
 * Scoped by `TASK_REMINDER_ID_PREFIX`, so the schedule/timer/journal
 * families sharing the same OS queue are left strictly alone.
 */
export async function pruneOrphanTaskReminders(
  tasks: readonly (Pick<Task, "id" | "dueDate"> & { status: TaskStatus })[],
  notifications: NotificationCapability,
): Promise<void> {
  let queuedIds: string[];
  try {
    queuedIds = await notifications.listScheduledIds();
  } catch (error) {
    console.warn("[task-reminders] could not list queued reminders to prune", error);
    return;
  }

  const expected = new Set(
    tasks.filter(isTaskReminderEligible).map((task) => reminderIdFor(task)),
  );
  const orphans = queuedIds.filter(
    (id) => id.startsWith(TASK_REMINDER_ID_PREFIX) && !expected.has(id),
  );

  for (const id of orphans) {
    try {
      await notifications.cancelNotification(id);
    } catch (error) {
      console.warn(`[task-reminders] could not cancel orphaned reminder ${id}`, error);
    }
  }
}
