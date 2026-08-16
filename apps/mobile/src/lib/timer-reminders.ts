// The "are you still tracking?" nudge that repeats while a timer runs.
//
// Ported from dw-time-web's Time Tracker, which offers a REMINDER control
// (dw-time-web/src/features/time-tracker/components/timer-settings.tsx) and
// drives it from a `setInterval` in use-timer-notifications.tsx. Everything
// the user can perceive is carried over verbatim: the same seven intervals,
// the same default, the same "Time Check" copy, reminders only while the
// timer is RUNNING, and the interval restarting from zero on resume.
//
// WHY this can't be a `setInterval` on mobile: a JS timer stops running the
// moment the OS suspends the app, which is exactly when the nudge matters
// most. So instead of counting down in-process, this hands the OS a batch of
// individually-scheduled notifications at absolute instants and lets it do
// the waiting. See useTimerReminders.ts for when these run.
//
// WHY the fire times are anchored to the session's `startedAt` rather than
// to "now + interval": absolute, anchor-derived instants make rescheduling
// IDEMPOTENT. Recomputing after a re-render, a screen remount or a cold start
// yields the identical set of still-pending instants, so re-issuing the batch
// leaves the cadence exactly where it was — the countdown never silently
// restarts just because the user opened the app, which is the failure mode a
// relative "fire in N minutes" trigger would have. (The slot an instant
// occupies does shift down as earlier reminders fire; what stays fixed is the
// set of instants, which is the part the user can perceive.)
//
// Pure functions over a NotificationCapability — no React, no store access —
// mirroring schedule-reminders.ts, so the reconciliation hook stays the only
// place that decides WHEN these run.

import type { NotificationCapability } from "@goalslot/shared";

import { DEFAULT_SESSION_LABEL } from "./session-label";

/**
 * The intervals offered on the Time Tracker, in minutes. Same seven values as
 * web's REMINDER_OPTIONS (timer-settings.tsx) — deliberately not a superset,
 * so a user who tracks on both platforms sees one product, not two.
 */
export const REMINDER_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const;

/** Web's default (`state.reminderInterval || 15`) and the store's initial value. */
export const DEFAULT_REMINDER_INTERVAL_MINUTES = 15;

/**
 * How many reminders are handed to the OS at once.
 *
 * A repeating trigger would need only one slot, but expo-notifications'
 * repeating triggers are relative to when they were scheduled, which is the
 * anchoring problem described in the header. Batching absolute instants buys
 * idempotence at the cost of a bounded lookahead, and this is where that
 * bound is set. Eight is chosen against iOS's hard 64-pending-notification
 * ceiling, which this app already shares with one weekly reminder per
 * schedule block (schedule-reminders.ts) — taking a bigger slice risks the
 * OS evicting those. At the default 15-minute interval it covers two hours
 * of uninterrupted background time, and the batch is topped back up every
 * time the app comes to the foreground (see useTimerReminders.ts), so the
 * lookahead only actually binds on a session that outruns it without the app
 * ever being opened.
 */
export const MAX_PENDING_TIMER_REMINDERS = 8;

/**
 * Upper bound on how far ahead the batch may reach, independent of the count.
 * At the longest interval the budget alone would queue notifications eight
 * hours out; a timer still running that far from now is far more likely to
 * have been left on by accident than to be a live session worth nudging.
 */
export const TIMER_REMINDER_LOOKAHEAD_MS = 6 * 60 * 60 * 1000;

/**
 * Shown when the session's task/goal title hasn't resolved yet. Same shared
 * constant useTimerNotification.ts and timer.tsx's UNRESOLVED_TARGET_LABEL
 * point at — see src/lib/session-label.ts for why this is one constant
 * rather than several copies.
 */
const UNRESOLVED_TARGET_LABEL = DEFAULT_SESSION_LABEL;

/**
 * Stable per-slot id. Re-issuing the same id replaces that entry rather than
 * stacking a duplicate — same guarantee reminderIdFor() relies on for
 * schedule blocks — and the fixed 0..MAX-1 range is what lets
 * cancelTimerReminders() clear the batch without having to remember what was
 * previously scheduled.
 */
export function timerReminderIdAt(index: number): string {
  return `goalslot-timer-reminder-${index}`;
}

/**
 * Snaps a persisted value onto one of the offered options, falling back to
 * the default. Guards the scheduler against a corrupted or hand-edited
 * AsyncStorage value: a 0 or negative interval would otherwise resolve to a
 * batch of instants at or before `now`, i.e. eight notifications firing at
 * once.
 */
export function normalizeReminderIntervalMinutes(minutes: unknown): number {
  return REMINDER_INTERVAL_OPTIONS.some((option) => option === minutes)
    ? (minutes as number)
    : DEFAULT_REMINDER_INTERVAL_MINUTES;
}

export interface TimerReminderScheduleArgs {
  /** Epoch ms the current running segment began — timer-store's `startedAt`. */
  anchorMs: number;
  intervalMinutes: number;
  /**
   * Task or goal title being tracked, or null when there is none to show —
   * an unattributed session or one whose target hasn't resolved yet.
   */
  label: string | null;
  /** Injectable for tests; defaults to the current wall clock. */
  nowMs?: number;
}

/**
 * The upcoming reminder instants for a session, ascending, all strictly in
 * the future.
 *
 * Every instant is `anchorMs + k * interval` for a whole k, so reminders land
 * on the session's own cadence no matter when this is called: a timer started
 * at 09:00 with a 15-minute interval is always reminded at 09:15/09:30/09:45,
 * whether the batch is computed at 09:00 or recomputed at 09:22.
 */
export function timerReminderFireTimes(args: {
  anchorMs: number;
  intervalMinutes: number;
  nowMs: number;
}): number[] {
  const { anchorMs, nowMs } = args;
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs)) return [];

  const intervalMs = normalizeReminderIntervalMinutes(args.intervalMinutes) * 60_000;
  const horizonMs = nowMs + TIMER_REMINDER_LOOKAHEAD_MS;

  // Skip every multiple already behind us. `+ 1` rather than `Math.ceil` so a
  // reminder due at exactly `now` counts as spent instead of being scheduled
  // for an instant the OS has no time left to honour.
  const firstMultiple = Math.max(1, Math.floor((nowMs - anchorMs) / intervalMs) + 1);

  const fireTimes: number[] = [];
  for (let k = firstMultiple; fireTimes.length < MAX_PENDING_TIMER_REMINDERS; k += 1) {
    const at = anchorMs + k * intervalMs;
    if (at > horizonMs) break;
    fireTimes.push(at);
  }
  return fireTimes;
}

/** The notification copy, carried over from web's use-timer-notifications.tsx. */
export function describeTimerReminder(label: string | null): { title: string; body: string } {
  return {
    title: "Time Check",
    body: `You are working on: ${label ?? UNRESOLVED_TARGET_LABEL}. Still strictly focused?`,
  };
}

/**
 * Brings the OS-scheduled batch in line with the given session.
 *
 * Writes the upcoming instants into slots 0..n-1 and releases every slot
 * above them, so shortening the interval, letting reminders fire, or nearing
 * the lookahead horizon all shrink the batch cleanly instead of leaving
 * orphaned entries queued.
 *
 * Deliberately carries no `data` payload: src/lib/deep-links.ts's
 * DeepLinkNotificationData has no "timer" case, so a tap opens the app rather
 * than routing somewhere the user didn't ask for — same call
 * useTimerNotification.ts makes for the ongoing entry.
 */
export async function scheduleTimerReminders(
  args: TimerReminderScheduleArgs,
  notifications: NotificationCapability,
): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  const fireTimes = timerReminderFireTimes({
    anchorMs: args.anchorMs,
    intervalMinutes: args.intervalMinutes,
    nowMs,
  });
  const { title, body } = describeTimerReminder(args.label);

  for (let index = 0; index < fireTimes.length; index += 1) {
    await notifications.scheduleNotification({
      id: timerReminderIdAt(index),
      title,
      body,
      fireAtUtc: new Date(fireTimes[index]).toISOString(),
    });
  }

  for (let index = fireTimes.length; index < MAX_PENDING_TIMER_REMINDERS; index += 1) {
    await notifications.cancelNotification(timerReminderIdAt(index));
  }
}

/** Clears the whole batch — every stop, and every pause. */
export async function cancelTimerReminders(notifications: NotificationCapability): Promise<void> {
  for (let index = 0; index < MAX_PENDING_TIMER_REMINDERS; index += 1) {
    await notifications.cancelNotification(timerReminderIdAt(index));
  }
}
