// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see notifications.test.ts and derive-online.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
import type { NotificationCapability, NotificationInput } from "@goalslot/shared";

import {
  DEFAULT_REMINDER_INTERVAL_MINUTES,
  MAX_PENDING_TIMER_REMINDERS,
  REMINDER_INTERVAL_OPTIONS,
  TIMER_REMINDER_LOOKAHEAD_MS,
  cancelTimerReminders,
  describeTimerReminder,
  normalizeReminderIntervalMinutes,
  scheduleTimerReminders,
  timerReminderFireTimes,
  timerReminderIdAt,
} from "./timer-reminders";

const MINUTE = 60_000;
/** Arbitrary fixed anchor so every expectation below is an exact instant, not a delta from "now". */
const ANCHOR = Date.parse("2026-08-12T09:00:00.000Z");

/**
 * Records what reached the capability port. Deliberately a hand-rolled fake
 * rather than a jest.mock of expo-notifications: everything in this module
 * goes through NotificationCapability, so the port is the real boundary to
 * assert against — notifications.test.ts already covers the expo side of it.
 */
function createRecordingNotifications() {
  const scheduled: NotificationInput[] = [];
  const cancelled: string[] = [];
  const capability: NotificationCapability = {
    async requestPermission() {
      return true;
    },
    async scheduleNotification(input) {
      scheduled.push(input);
    },
    async cancelNotification(id) {
      cancelled.push(id);
    },
    async clearAllNotifications() {
      // Nothing in this module calls it — the bulk sweep belongs to sign-out
      // (session-reset.ts), which is tested there. Present only so the fake
      // still satisfies the port.
    },
  };
  return { capability, scheduled, cancelled };
}

describe("REMINDER_INTERVAL_OPTIONS", () => {
  it("offers exactly the intervals web's timer-settings.tsx offers", () => {
    expect([...REMINDER_INTERVAL_OPTIONS]).toEqual([5, 10, 15, 20, 30, 45, 60]);
  });

  it("defaults to the same 15 minutes web falls back to", () => {
    expect(DEFAULT_REMINDER_INTERVAL_MINUTES).toBe(15);
    expect([...REMINDER_INTERVAL_OPTIONS]).toContain(DEFAULT_REMINDER_INTERVAL_MINUTES);
  });
});

describe("normalizeReminderIntervalMinutes", () => {
  it("passes every offered option through untouched", () => {
    for (const option of REMINDER_INTERVAL_OPTIONS) {
      expect(normalizeReminderIntervalMinutes(option)).toBe(option);
    }
  });

  it.each([0, -5, 7, 1.5, NaN, null, undefined, "15", {}])(
    "falls back to the default for %p",
    (value) => {
      expect(normalizeReminderIntervalMinutes(value)).toBe(DEFAULT_REMINDER_INTERVAL_MINUTES);
    },
  );
});

describe("timerReminderFireTimes", () => {
  it("lands on multiples of the interval measured from the session start", () => {
    const times = timerReminderFireTimes({ anchorMs: ANCHOR, intervalMinutes: 15, nowMs: ANCHOR });

    expect(times.slice(0, 3)).toEqual([ANCHOR + 15 * MINUTE, ANCHOR + 30 * MINUTE, ANCHOR + 45 * MINUTE]);
  });

  it("keeps the same cadence when recomputed mid-session, without shifting it", () => {
    // The property the whole design rests on: a re-render, remount or cold
    // start 22 minutes in must not restart the countdown.
    const atStart = timerReminderFireTimes({ anchorMs: ANCHOR, intervalMinutes: 15, nowMs: ANCHOR });
    const later = timerReminderFireTimes({
      anchorMs: ANCHOR,
      intervalMinutes: 15,
      nowMs: ANCHOR + 22 * MINUTE,
    });

    expect(later[0]).toBe(ANCHOR + 30 * MINUTE);
    // Every instant still pending at the recompute is byte-identical to the
    // one originally queued, so re-issuing it replaces rather than reschedules.
    expect(later.slice(0, 2)).toEqual(atStart.slice(1, 3));
  });

  it("drops multiples that have already passed", () => {
    const times = timerReminderFireTimes({
      anchorMs: ANCHOR,
      intervalMinutes: 10,
      nowMs: ANCHOR + 35 * MINUTE,
    });

    expect(times[0]).toBe(ANCHOR + 40 * MINUTE);
    expect(times.every((at) => at > ANCHOR + 35 * MINUTE)).toBe(true);
  });

  it("treats a reminder due at exactly now as spent rather than scheduling it in the past", () => {
    const times = timerReminderFireTimes({
      anchorMs: ANCHOR,
      intervalMinutes: 15,
      nowMs: ANCHOR + 15 * MINUTE,
    });

    expect(times[0]).toBe(ANCHOR + 30 * MINUTE);
  });

  it("never queues more than the pending-notification budget allows", () => {
    const times = timerReminderFireTimes({ anchorMs: ANCHOR, intervalMinutes: 5, nowMs: ANCHOR });

    expect(times).toHaveLength(MAX_PENDING_TIMER_REMINDERS);
  });

  it("stops at the lookahead horizon even when the budget isn't spent", () => {
    // 8 x 60min would reach 8 hours; the 6-hour horizon cuts it to 6.
    const times = timerReminderFireTimes({ anchorMs: ANCHOR, intervalMinutes: 60, nowMs: ANCHOR });

    expect(times.length).toBeLessThan(MAX_PENDING_TIMER_REMINDERS);
    expect(times[times.length - 1]).toBeLessThanOrEqual(ANCHOR + TIMER_REMINDER_LOOKAHEAD_MS);
  });

  it("normalises a corrupted interval instead of emitting a burst of past instants", () => {
    const times = timerReminderFireTimes({ anchorMs: ANCHOR, intervalMinutes: 0, nowMs: ANCHOR });

    expect(times[0]).toBe(ANCHOR + DEFAULT_REMINDER_INTERVAL_MINUTES * MINUTE);
  });

  it("returns nothing for a non-finite anchor", () => {
    expect(timerReminderFireTimes({ anchorMs: NaN, intervalMinutes: 15, nowMs: ANCHOR })).toEqual([]);
  });
});

describe("describeTimerReminder", () => {
  it("uses web's Time Check copy", () => {
    expect(describeTimerReminder("Write the spec")).toEqual({
      title: "Time Check",
      body: "You are working on: Write the spec. Still strictly focused?",
    });
  });

  it("falls back to the app's own unresolved-session wording", () => {
    expect(describeTimerReminder(null).body).toBe(
      "You are working on: Focus session. Still strictly focused?",
    );
  });
});

describe("scheduleTimerReminders", () => {
  it("schedules one notification per upcoming instant, into consecutive slots", async () => {
    const { capability, scheduled } = createRecordingNotifications();

    await scheduleTimerReminders(
      { anchorMs: ANCHOR, intervalMinutes: 30, label: "Deep work", nowMs: ANCHOR },
      capability,
    );

    expect(scheduled.map((input) => input.id)).toEqual(
      Array.from({ length: MAX_PENDING_TIMER_REMINDERS }, (_, index) => timerReminderIdAt(index)),
    );
    expect(scheduled[0]).toEqual({
      id: "goalslot-timer-reminder-0",
      title: "Time Check",
      body: "You are working on: Deep work. Still strictly focused?",
      fireAtUtc: new Date(ANCHOR + 30 * MINUTE).toISOString(),
    });
  });

  it("re-issues the same instants when called again mid-session, so the cadence never drifts", async () => {
    const first = createRecordingNotifications();
    const second = createRecordingNotifications();

    await scheduleTimerReminders(
      { anchorMs: ANCHOR, intervalMinutes: 15, label: "Deep work", nowMs: ANCHOR },
      first.capability,
    );
    await scheduleTimerReminders(
      { anchorMs: ANCHOR, intervalMinutes: 15, label: "Deep work", nowMs: ANCHOR + 30 * MINUTE },
      second.capability,
    );

    // Two reminders have fired by the recompute, so the batch slides down two
    // slots — but the instants it re-issues are the very ones the first pass
    // had already queued, which is what stops a reschedule from restarting
    // the countdown.
    const firstTimes = first.scheduled.map((input) => input.fireAtUtc);
    const secondTimes = second.scheduled.map((input) => input.fireAtUtc);
    expect(secondTimes.slice(0, 6)).toEqual(firstTimes.slice(2));
  });

  it("releases the slots above the ones it just wrote", async () => {
    const { capability, scheduled, cancelled } = createRecordingNotifications();

    await scheduleTimerReminders(
      { anchorMs: ANCHOR, intervalMinutes: 60, label: "Deep work", nowMs: ANCHOR },
      capability,
    );

    expect(scheduled).toHaveLength(6);
    expect(cancelled).toEqual([timerReminderIdAt(6), timerReminderIdAt(7)]);
  });

  it("never schedules an instant in the past", async () => {
    const { capability, scheduled } = createRecordingNotifications();
    const now = ANCHOR + 47 * MINUTE;

    await scheduleTimerReminders(
      { anchorMs: ANCHOR, intervalMinutes: 15, label: null, nowMs: now },
      capability,
    );

    for (const input of scheduled) {
      expect(Date.parse(input.fireAtUtc as string)).toBeGreaterThan(now);
    }
  });
});

describe("cancelTimerReminders", () => {
  it("clears every slot in the batch", async () => {
    const { capability, cancelled } = createRecordingNotifications();

    await cancelTimerReminders(capability);

    expect(cancelled).toEqual(
      Array.from({ length: MAX_PENDING_TIMER_REMINDERS }, (_, index) => timerReminderIdAt(index)),
    );
  });

  it("clears exactly the ids scheduleTimerReminders can write", async () => {
    const scheduling = createRecordingNotifications();
    const cancelling = createRecordingNotifications();

    await scheduleTimerReminders(
      { anchorMs: ANCHOR, intervalMinutes: 5, label: "Deep work", nowMs: ANCHOR },
      scheduling.capability,
    );
    await cancelTimerReminders(cancelling.capability);

    for (const input of scheduling.scheduled) {
      expect(cancelling.cancelled).toContain(input.id);
    }
  });
});
