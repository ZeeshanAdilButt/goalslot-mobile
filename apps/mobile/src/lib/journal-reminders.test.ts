// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see timer-reminders.test.ts for the same rationale), so this file is
// excluded from `tsc --noEmit` via tsconfig.json's `exclude`.
import type { NotificationCapability, NotificationInput } from "@goalslot/shared";

import {
  DEFAULT_JOURNAL_REMINDER_HOUR,
  JOURNAL_REMINDER_HOUR_OPTIONS,
  JOURNAL_REMINDER_ID,
  cancelJournalReminder,
  describeJournalReminder,
  journalReminderFireTime,
  normalizeJournalReminderHour,
  reconcileJournalReminder,
  scheduleJournalReminder,
} from "./journal-reminders";

/** Recording fake, same shape timer-reminders.test.ts uses to assert against the real port. */
function createRecordingNotifications() {
  const scheduled: NotificationInput[] = [];
  const cancelled: string[] = [];
  const capability: NotificationCapability = {
    async getPermissionStatus() {
      return "granted";
    },
    async requestPermission() {
      return true;
    },
    async scheduleNotification(input) {
      scheduled.push(input);
    },
    async cancelNotification(id) {
      cancelled.push(id);
    },
    async listScheduledIds() {
      return scheduled.map((s) => s.id);
    },
    async clearAllNotifications() {
      // Nothing in this module calls it.
    },
  };
  return { capability, scheduled, cancelled };
}

describe("normalizeJournalReminderHour", () => {
  it("keeps a valid offered hour", () => {
    expect(normalizeJournalReminderHour(21)).toBe(21);
  });

  it("falls back to the default for anything off the offered list", () => {
    for (const value of [0, 12, 23, -1, "20", null, undefined]) {
      expect(normalizeJournalReminderHour(value)).toBe(DEFAULT_JOURNAL_REMINDER_HOUR);
    }
  });
});

describe("journalReminderFireTime", () => {
  it("lands later today when the hour hasn't happened yet", () => {
    const nowMs = Date.parse("2026-08-13T10:00:00");
    const fireAt = journalReminderFireTime({ hourOfDay: 20, nowMs });
    const fireDate = new Date(fireAt);

    expect(fireDate.getDate()).toBe(new Date(nowMs).getDate());
    expect(fireDate.getHours()).toBe(20);
    expect(fireDate.getMinutes()).toBe(0);
  });

  it("rolls over to tomorrow when the hour has already passed", () => {
    const nowMs = Date.parse("2026-08-13T21:00:00");
    const fireAt = journalReminderFireTime({ hourOfDay: 20, nowMs });
    const fireDate = new Date(fireAt);

    expect(fireDate.getDate()).toBe(new Date(nowMs).getDate() + 1);
    expect(fireDate.getHours()).toBe(20);
  });

  it("rolls over when now is exactly on the hour, not just after it", () => {
    const nowMs = Date.parse("2026-08-13T20:00:00");
    const fireAt = journalReminderFireTime({ hourOfDay: 20, nowMs });

    expect(fireAt).toBeGreaterThan(nowMs);
    expect(new Date(fireAt).getDate()).toBe(new Date(nowMs).getDate() + 1);
  });
});

describe("scheduleJournalReminder", () => {
  it("schedules a single one-shot notification under the stable id", async () => {
    const { capability, scheduled } = createRecordingNotifications();
    const nowMs = Date.parse("2026-08-13T10:00:00");

    await scheduleJournalReminder({ hourOfDay: 20, nowMs }, capability);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].id).toBe(JOURNAL_REMINDER_ID);
    expect(scheduled[0]).toMatchObject({ data: { type: "journal" } });
  });

  it("normalizes an out-of-range hour before computing the fire time", async () => {
    const { capability, scheduled } = createRecordingNotifications();
    const nowMs = Date.parse("2026-08-13T10:00:00");

    await scheduleJournalReminder({ hourOfDay: 3, nowMs }, capability);

    const fireAtUtc = scheduled[0].fireAtUtc as string;
    expect(new Date(fireAtUtc).getHours()).toBe(DEFAULT_JOURNAL_REMINDER_HOUR);
  });
});

describe("cancelJournalReminder", () => {
  it("cancels the stable id", async () => {
    const { capability, cancelled } = createRecordingNotifications();

    await cancelJournalReminder(capability);

    expect(cancelled).toEqual([JOURNAL_REMINDER_ID]);
  });
});

describe("reconcileJournalReminder", () => {
  const nowMs = Date.parse("2026-08-13T10:00:00");

  it("schedules when enabled and today has no content yet", async () => {
    const { capability, scheduled, cancelled } = createRecordingNotifications();

    await reconcileJournalReminder({ enabled: true, hourOfDay: 20, hasJournaledToday: false, nowMs }, capability);

    expect(scheduled).toHaveLength(1);
    expect(cancelled).toHaveLength(0);
  });

  it("cancels instead of scheduling once today is already journaled", async () => {
    const { capability, scheduled, cancelled } = createRecordingNotifications();

    await reconcileJournalReminder({ enabled: true, hourOfDay: 20, hasJournaledToday: true, nowMs }, capability);

    expect(scheduled).toHaveLength(0);
    expect(cancelled).toEqual([JOURNAL_REMINDER_ID]);
  });

  it("cancels when the setting is off, regardless of today's content", async () => {
    const { capability, scheduled, cancelled } = createRecordingNotifications();

    await reconcileJournalReminder({ enabled: false, hourOfDay: 20, hasJournaledToday: false, nowMs }, capability);

    expect(scheduled).toHaveLength(0);
    expect(cancelled).toEqual([JOURNAL_REMINDER_ID]);
  });
});

describe("JOURNAL_REMINDER_HOUR_OPTIONS", () => {
  it("is an evening-weighted, ascending list that includes the default", () => {
    expect([...JOURNAL_REMINDER_HOUR_OPTIONS]).toEqual([18, 19, 20, 21, 22]);
    expect(JOURNAL_REMINDER_HOUR_OPTIONS).toContain(DEFAULT_JOURNAL_REMINDER_HOUR);
  });
});

describe("describeJournalReminder", () => {
  it("returns stable, non-empty copy", () => {
    const { title, body } = describeJournalReminder();
    expect(title.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
  });
});
