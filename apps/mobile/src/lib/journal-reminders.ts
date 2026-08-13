// "You haven't written in your journal today" — a once-daily local nudge.
// Pure functions over a NotificationCapability — no React, no store access —
// same shape as timer-reminders.ts and schedule-reminders.ts, so the
// reconciliation hook (useJournalReminders.ts) stays the only place that
// decides WHEN these run.
//
// WHY one-shot (fireAtUtc), not RecurringNotificationInput's weekly repeat:
// the whole point of this feature is that it SKIPS itself on a day the user
// already journaled (see useJournalReminders.ts), and an OS-native recurring
// trigger has no per-occurrence cancel — silencing one firing would silence
// every future one on that weekday. A one-shot re-armed for "the next
// instant this is still relevant" is the only shape that supports skipping a
// single day without touching the rest of the series, mirroring exactly why
// timer-reminders.ts uses individually-scheduled instants instead of a
// repeating trigger. The tradeoff (documented on the hook) is that arming
// tomorrow's reminder depends on the app being reconciled at least once
// between firings, same as timer-reminders' batch depends on the app being
// foregrounded to stay topped up.
//
// SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM (app.json's `_permissionsComment`)
// already cover this: expo-notifications picks its AlarmManager method for
// every scheduled notification, not just ones that opt into `alarm: true`,
// so a journal reminder lands on time without asking for anything new here.

import type { NotificationCapability } from "@goalslot/shared";

/**
 * Evening hours offered in Settings. Deliberately a short, evening-weighted
 * list rather than the full 24 — "did you journal today" only makes sense
 * once most of the day has actually happened.
 */
export const JOURNAL_REMINDER_HOUR_OPTIONS = [18, 19, 20, 21, 22] as const;

export type JournalReminderHour = (typeof JOURNAL_REMINDER_HOUR_OPTIONS)[number];

/** 8pm — late enough that "today" has mostly happened, early enough not to feel like a scold. */
export const DEFAULT_JOURNAL_REMINDER_HOUR: JournalReminderHour = 20;

/** Stable id: re-issuing it replaces any pending entry rather than stacking a duplicate. */
export const JOURNAL_REMINDER_ID = "goalslot-journal-reminder";

/**
 * Snaps a persisted value onto one of the offered hours, falling back to the
 * default. Guards the scheduler against a corrupted or hand-edited
 * AsyncStorage value the same way normalizeReminderIntervalMinutes guards
 * the timer's interval.
 */
export function normalizeJournalReminderHour(hour: unknown): number {
  return JOURNAL_REMINDER_HOUR_OPTIONS.some((option) => option === hour)
    ? (hour as number)
    : DEFAULT_JOURNAL_REMINDER_HOUR;
}

/** The notification copy. */
export function describeJournalReminder(): { title: string; body: string } {
  return {
    title: "Journal reminder",
    body: "You haven't written in your journal today — take a minute to reflect.",
  };
}

/**
 * The next epoch ms at which `hourOfDay:00` local time occurs — today if
 * that instant is still ahead of `nowMs`, tomorrow otherwise. Minutes are
 * always :00; the picker only offers whole hours (see JOURNAL_REMINDER_HOUR_OPTIONS).
 */
export function journalReminderFireTime(args: { hourOfDay: number; nowMs: number }): number {
  const now = new Date(args.nowMs);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), args.hourOfDay, 0, 0, 0);
  if (candidate.getTime() <= args.nowMs) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
}

/** Arms the single pending reminder at the next relevant instant for `hourOfDay`. */
export async function scheduleJournalReminder(
  args: { hourOfDay: number; nowMs?: number },
  notifications: NotificationCapability,
): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  const fireAt = journalReminderFireTime({ hourOfDay: normalizeJournalReminderHour(args.hourOfDay), nowMs });
  const { title, body } = describeJournalReminder();

  await notifications.scheduleNotification({
    id: JOURNAL_REMINDER_ID,
    title,
    body,
    fireAtUtc: new Date(fireAt).toISOString(),
    // Opens straight to the Journal tab rather than cold-opening to Today —
    // see deep-links.ts's "journal" DeepLinkNotificationData case.
    data: { type: "journal" },
  });
}

/** Cancels the pending reminder — used when the setting is off or today is already covered. */
export async function cancelJournalReminder(notifications: NotificationCapability): Promise<void> {
  await notifications.cancelNotification(JOURNAL_REMINDER_ID);
}

/**
 * Brings the OS's single pending journal reminder in line with the given
 * state. Cancels rather than arms when the setting is off OR today's entry
 * already has content — the "skip a day already journaled" behaviour the
 * feature exists for.
 */
export async function reconcileJournalReminder(
  args: { enabled: boolean; hourOfDay: number; hasJournaledToday: boolean; nowMs?: number },
  notifications: NotificationCapability,
): Promise<void> {
  if (!args.enabled || args.hasJournaledToday) {
    await cancelJournalReminder(notifications);
    return;
  }
  await scheduleJournalReminder({ hourOfDay: args.hourOfDay, nowMs: args.nowMs }, notifications);
}
