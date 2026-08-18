// Schedules and cancels the combined "N tasks due today" digest reminder —
// one notification per configured hour of the day, each summarising every
// eligible task rather than one notification per task. Pure functions over a
// NotificationCapability — no React, no store access — same shape as
// task-reminders.ts (which this replaces) and journal-reminders.ts, so the
// reconciliation hook (useTaskDigestReminders.ts) stays the only place that
// decides WHEN these run.
//
// WHY this exists: task-reminders.ts scheduled one one-shot notification PER
// TASK, fixed at 9am on that task's due date. A user with 5 tasks due today
// got 5 separate notifications, all firing at once. This module replaces
// that entirely with a single "You have 5 tasks due today" notification,
// fired at a user-configured set of times per day (settings-store's
// taskDigestHours, default 9am/1pm/6pm) rather than one fixed hour.
//
// WHY one-shot (fireAtUtc) per configured hour, not a repeating trigger, and
// WHY reconciliation re-arms rather than the OS handling "daily" natively:
// see journal-reminders.ts's header for the full reasoning — the short
// version is that expo-notifications' NotificationInput has no daily-repeat
// trigger shape (only a one-shot absolute instant or a weekly weekday/hour/
// minute repeat), and even if it did, a digest whose count changes every day
// needs its body text re-computed per firing anyway, which a native repeat
// can't do. So: one one-shot per configured hour, scheduled for TODAY only,
// re-armed on every reconcile pass. If a reconcile pass never runs again
// before an hour's slot arrives (app never foregrounded, no relevant screen
// focused), that slot silently doesn't fire — same documented, accepted
// limitation task-reminders.ts and journal-reminders.ts both carry: there is
// no reliable background/headless execution path on this app (no push
// entitlement on the free Apple dev account; BGTaskScheduler is scoped to
// messages only).
//
// WHY today-only, not "skip to tomorrow" like journalReminderFireTime does:
// journal has exactly one slot, so rolling a passed slot to tomorrow is the
// only way it ever fires again. This module has multiple slots per day, and
// the next reconcile pass (whenever it happens) re-evaluates "today" fresh
// against the current wall-clock hour — there is no need to pre-compute
// tomorrow's instant now, and doing so would require this module to track
// "have I already fired today's 9am slot" state it otherwise doesn't need.

import type { NotificationCapability, Task, TaskStatus } from "@goalslot/shared";

import { toDueDateKey } from "@/components/tasks/due-date";

/**
 * Namespace every task-digest reminder shares. Used both to mint ids and, in
 * `reconcileTaskDigestReminders`, to recognise our own entries in the OS
 * queue without touching the schedule/timer/journal/task-reminder families
 * sharing the same queue. Deliberately distinct from the retired
 * TASK_REMINDER_ID_PREFIX ("task-reminder-") rather than reusing it — the
 * two features' ids must never collide or be mistaken for one another during
 * the transition.
 */
export const TASK_DIGEST_ID_PREFIX = "task-digest-";

/** Stable id per configured hour, e.g. `task-digest-9` — re-issuing it replaces any pending entry for that hour rather than stacking a duplicate. */
export function taskDigestIdFor(hour: number): string {
  return `${TASK_DIGEST_ID_PREFIX}${hour}`;
}

/** 9am / 1pm / 6pm — a spread across the working day rather than one fixed morning slot, matching what the user actually asked for. */
export const DEFAULT_TASK_DIGEST_HOURS: number[] = [9, 13, 18];

/**
 * Snaps a persisted/user-supplied value onto a clean, sorted, deduped list
 * of whole hours (0-23). Falls back to the default set if the result would
 * otherwise be empty — this setting must never leave the user with zero
 * configured times, whether from a corrupted AsyncStorage value or a caller
 * bug that hands in an empty array.
 */
export function normalizeTaskDigestHours(hours: unknown): number[] {
  if (!Array.isArray(hours)) return [...DEFAULT_TASK_DIGEST_HOURS];
  const cleaned = Array.from(
    new Set(
      hours.filter(
        (hour): hour is number => typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23,
      ),
    ),
  ).sort((a, b) => a - b);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_TASK_DIGEST_HOURS];
}

/**
 * A task counts toward the due-today digest under the exact same
 * eligibility rule task-reminders.ts used: an actual, readable `dueDate`
 * (not the looser "undated TODO/DOING" definition the Today screen dashboard
 * uses elsewhere in this app) that resolves to today's date key, and not yet
 * DONE. This is specifically a due-DATE reminder, so it uses the stricter
 * definition.
 */
export function isTaskDueTodayForDigest(
  task: Pick<Task, "dueDate"> & { status: TaskStatus },
  todayStr: string,
): boolean {
  if (task.status === "DONE") return false;
  return toDueDateKey(task.dueDate) === todayStr;
}

/** How many of the given tasks are due today and not yet done. */
export function countDueTodayTasks(tasks: readonly Task[], todayStr: string): number {
  return tasks.filter((task) => isTaskDueTodayForDigest(task, todayStr)).length;
}

/** "You have 3 tasks due today" / "You have 1 task due today" — singular when the count is exactly 1. */
export function describeTaskDigest(count: number): { title: string; body: string } {
  return {
    title: "Tasks due today",
    body: count === 1 ? "You have 1 task due today" : `You have ${count} tasks due today`,
  };
}

/**
 * How many minutes past an hour's slot it's still treated as "hasn't fired
 * yet" rather than skipped outright. Mirrors the reasoning of
 * SAME_DAY_CLAMP_MINUTES in task-reminders.ts, inverted: there, a passed
 * slot got clamped forward a few minutes so it still fired today. Here,
 * scheduling a one-shot notification for an instant that's already slightly
 * in the past is itself fine (expo-notifications fires it ~immediately), so
 * a small grace window just avoids re-arming a slot that in practice already
 * fired moments ago and got raced by this reconcile pass.
 */
const GRACE_WINDOW_MINUTES = 1;

/**
 * The epoch ms `hourOfDay:00` occurs today, local time — regardless of
 * whether that instant is in the past or future relative to `nowMs`.
 * Callers decide what "already passed" means (see
 * `reconcileTaskDigestReminders`'s grace window).
 */
export function taskDigestFireTimeToday(args: { hourOfDay: number; nowMs?: number }): number {
  const nowMs = args.nowMs ?? Date.now();
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), args.hourOfDay, 0, 0, 0).getTime();
}

/**
 * Arms (or overwrites) the digest notification for one configured hour,
 * scheduled for today's occurrence of that hour regardless of whether it has
 * already passed — callers that want the "skip if already passed" behaviour
 * go through `reconcileTaskDigestReminders` instead of calling this
 * directly.
 */
export async function scheduleTaskDigestReminder(
  args: { hourOfDay: number; count: number; nowMs?: number },
  notifications: NotificationCapability,
): Promise<void> {
  const fireAt = taskDigestFireTimeToday({ hourOfDay: args.hourOfDay, nowMs: args.nowMs });
  const { title, body } = describeTaskDigest(args.count);

  await notifications.scheduleNotification({
    id: taskDigestIdFor(args.hourOfDay),
    title,
    body,
    fireAtUtc: new Date(fireAt).toISOString(),
    // No specific task to deep-link to (this summarises many) — opens to the
    // Tasks tab. deep-links.ts's DeepLinkNotificationData "task" case
    // requires an `id`; a digest has none, so this intentionally omits
    // `data` and falls back to whatever a dataless notification tap does
    // (cold-opens to Today, same as any other unmatched payload).
  });
}

/** Cancels one configured hour's pending digest entry. */
export async function cancelTaskDigestReminder(
  hourOfDay: number,
  notifications: NotificationCapability,
): Promise<void> {
  await notifications.cancelNotification(taskDigestIdFor(hourOfDay));
}

/**
 * Brings the OS's queue of `task-digest-*` entries in line with the current
 * settings and task list:
 *   - disabled, or zero tasks due today: every configured hour's entry is
 *     cancelled (nothing worth interrupting anyone about).
 *   - enabled and count > 0: each configured hour whose today-slot hasn't
 *     already passed (past the grace window) is (re)armed with the current
 *     count; each configured hour whose slot HAS already passed is
 *     cancelled rather than left stale, and NOT rescheduled for tomorrow —
 *     the next reconcile pass re-evaluates "today" fresh (see module
 *     header).
 *   - any hour previously scheduled that is no longer in the current
 *     configured-hours set (the user removed a time slot) is cancelled —
 *     this is the orphan-within-today's-set case; a fully-deleted task
 *     doesn't need its own prune pass the way task-reminders.ts's
 *     per-task ids did, because these ids are keyed on hour, not task.
 *
 * One hour failing must never abort the rest, hence the per-item guard —
 * same reasoning as reconcileTaskReminders.
 */
export async function reconcileTaskDigestReminders(
  args: {
    tasks: readonly Task[];
    enabled: boolean;
    hours: readonly number[];
    todayStr: string;
    nowMs?: number;
  },
  notifications: NotificationCapability,
): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  const configuredHours = normalizeTaskDigestHours([...args.hours]);
  const count = args.enabled ? countDueTodayTasks(args.tasks, args.todayStr) : 0;

  for (const hour of configuredHours) {
    try {
      if (!args.enabled || count === 0) {
        await cancelTaskDigestReminder(hour, notifications);
        continue;
      }
      const fireAt = taskDigestFireTimeToday({ hourOfDay: hour, nowMs });
      const alreadyPassed = fireAt <= nowMs - GRACE_WINDOW_MINUTES * 60 * 1000;
      if (alreadyPassed) {
        await cancelTaskDigestReminder(hour, notifications);
        continue;
      }
      await scheduleTaskDigestReminder({ hourOfDay: hour, count, nowMs }, notifications);
    } catch (error) {
      console.warn(`[task-digest-reminders] could not reconcile digest for hour ${hour}`, error);
    }
  }

  await pruneOrphanTaskDigestReminders(configuredHours, notifications);
}

/**
 * Cancels queued `task-digest-*` entries for hours no longer in the current
 * configured set — the user removed a time slot since the last reconcile.
 * Scoped by `TASK_DIGEST_ID_PREFIX`, so the schedule/timer/journal/
 * task-reminder families sharing the same OS queue are left strictly alone.
 */
export async function pruneOrphanTaskDigestReminders(
  configuredHours: readonly number[],
  notifications: NotificationCapability,
): Promise<void> {
  let queuedIds: string[];
  try {
    queuedIds = await notifications.listScheduledIds();
  } catch (error) {
    console.warn("[task-digest-reminders] could not list queued reminders to prune", error);
    return;
  }

  const expected = new Set(configuredHours.map((hour) => taskDigestIdFor(hour)));
  const orphans = queuedIds.filter((id) => id.startsWith(TASK_DIGEST_ID_PREFIX) && !expected.has(id));

  for (const id of orphans) {
    try {
      await notifications.cancelNotification(id);
    } catch (error) {
      console.warn(`[task-digest-reminders] could not cancel orphaned digest ${id}`, error);
    }
  }
}
