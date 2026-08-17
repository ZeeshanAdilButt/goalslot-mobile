// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see journal-reminders.test.ts for the same rationale), so this file is
// excluded from `tsc --noEmit` via tsconfig.json's `exclude`.
//
// Cancellation/pruning is the half of this feature that has to be right, for
// the same reason schedule-reminders.test.ts's header explains: a queued
// reminder fires whether or not the app still agrees with it, so "stopped
// scheduling it" and "actually cancelled it" are different outcomes. These
// tests run against a modelled OS queue rather than assertion-counting.

import type { NotificationCapability, NotificationInput, Task } from "@goalslot/shared";

import {
  DEFAULT_TASK_REMINDER_HOUR,
  TASK_REMINDER_ID_PREFIX,
  cancelTaskReminder,
  isTaskReminderEligible,
  pruneOrphanTaskReminders,
  reconcileTaskReminders,
  reminderIdFor,
  scheduleTaskReminder,
  taskReminderFireTime,
} from "./task-reminders";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "TODO",
    ...overrides,
  } as Task;
}

/** Stands in for the OS's pending-notification queue, exactly like scheduleNotification overwriting by id. */
function createQueue() {
  const queue = new Map<string, NotificationInput>();
  const capability: NotificationCapability = {
    async getPermissionStatus() {
      return "granted";
    },
    async requestPermission() {
      return true;
    },
    async scheduleNotification(input) {
      queue.set(input.id, input);
    },
    async cancelNotification(id) {
      queue.delete(id);
    },
    async listScheduledIds() {
      return Array.from(queue.keys());
    },
    async clearAllNotifications() {
      queue.clear();
    },
  };
  return { queue, capability };
}

describe("reminderIdFor", () => {
  it("is stable and namespaced under the task-reminder prefix", () => {
    expect(reminderIdFor({ id: "t_1" })).toBe(`${TASK_REMINDER_ID_PREFIX}t_1`);
    expect(reminderIdFor({ id: "t_1" })).toBe(reminderIdFor({ id: "t_1" }));
  });
});

describe("isTaskReminderEligible", () => {
  it("is true for a TODO/DOING/BACKLOG task with a readable due date", () => {
    for (const status of ["BACKLOG", "TODO", "DOING"] as const) {
      expect(
        isTaskReminderEligible({ status, dueDate: "2026-08-20T00:00:00.000Z" }),
      ).toBe(true);
    }
  });

  it("is false once the task is DONE, even with a due date", () => {
    expect(
      isTaskReminderEligible({ status: "DONE", dueDate: "2026-08-20T00:00:00.000Z" }),
    ).toBe(false);
  });

  it("is false with no due date at all", () => {
    expect(isTaskReminderEligible({ status: "TODO", dueDate: undefined })).toBe(false);
  });

  it("is false for an unparseable due date", () => {
    expect(isTaskReminderEligible({ status: "TODO", dueDate: "not-a-date" })).toBe(false);
  });
});

describe("taskReminderFireTime", () => {
  it("lands at the default 9am on a due date that is still ahead", () => {
    const nowMs = Date.parse("2026-08-17T10:00:00");
    const fireAt = taskReminderFireTime({ dueDateKey: "2026-08-20", nowMs });
    const d = new Date(fireAt);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // 0-indexed August
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(DEFAULT_TASK_REMINDER_HOUR);
    expect(d.getMinutes()).toBe(0);
  });

  it("lands at 9am today when the due date is today and 9am hasn't happened yet", () => {
    const nowMs = Date.parse("2026-08-17T06:00:00");
    const fireAt = taskReminderFireTime({ dueDateKey: "2026-08-17", nowMs });
    const d = new Date(fireAt);
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(9);
  });

  it("clamps to a few minutes from now when the due date is today but 9am already passed", () => {
    const nowMs = Date.parse("2026-08-17T14:00:00");
    const fireAt = taskReminderFireTime({ dueDateKey: "2026-08-17", nowMs });
    // Must not silently be in the past, and must not be pushed a whole day out either.
    expect(fireAt).toBeGreaterThan(nowMs);
    expect(fireAt).toBeLessThan(nowMs + 60 * 60 * 1000);
  });

  it("clamps to a few minutes from now when the due date is already in the past", () => {
    const nowMs = Date.parse("2026-08-17T10:00:00");
    const fireAt = taskReminderFireTime({ dueDateKey: "2026-08-10", nowMs });
    expect(fireAt).toBeGreaterThan(nowMs);
    expect(fireAt).toBeLessThan(nowMs + 60 * 60 * 1000);
  });

  it("respects a custom hourOfDay", () => {
    const nowMs = Date.parse("2026-08-17T06:00:00");
    const fireAt = taskReminderFireTime({ dueDateKey: "2026-08-20", hourOfDay: 15, nowMs });
    expect(new Date(fireAt).getHours()).toBe(15);
  });

  it("handles a due date on a month/year boundary correctly (no off-by-one month index bug)", () => {
    const nowMs = Date.parse("2026-12-01T00:00:00");
    const fireAt = taskReminderFireTime({ dueDateKey: "2026-12-31", nowMs });
    const d = new Date(fireAt);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11); // December, not rolled into January
    expect(d.getDate()).toBe(31);
  });
});

describe("scheduleTaskReminder", () => {
  it("schedules a one-shot reminder with the task deep-link payload", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-17T06:00:00");

    await scheduleTaskReminder(
      task("t_1", { title: "Call the bank", dueDate: "2026-08-20T00:00:00.000Z" }),
      capability,
      { nowMs },
    );

    const entry = queue.get(reminderIdFor({ id: "t_1" }));
    expect(entry).toBeDefined();
    expect(entry?.title).toBe("Call the bank");
    expect(entry?.data).toEqual({ type: "task", id: "t_1" });
    expect(entry?.fireAtUtc).toBeDefined();
    // One-shot, not a repeating trigger — see the module header for why.
    expect(entry?.repeat).toBeUndefined();
  });

  it("does not schedule anything for a task with no readable due date", async () => {
    const { queue, capability } = createQueue();

    await scheduleTaskReminder(task("t_1", { dueDate: undefined }), capability);

    expect(queue.size).toBe(0);
  });
});

describe("cancelTaskReminder", () => {
  it("removes the task's entry from the OS queue", async () => {
    const { queue, capability } = createQueue();
    await scheduleTaskReminder(
      task("t_1", { dueDate: "2026-08-20T00:00:00.000Z" }),
      capability,
    );
    expect(queue.size).toBe(1);

    await cancelTaskReminder({ id: "t_1" }, capability);

    expect(queue.size).toBe(0);
  });
});

describe("reconcileTaskReminders", () => {
  it("arms eligible tasks and cancels a task once it is marked DONE", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-17T06:00:00");

    await reconcileTaskReminders(
      [task("t_1", { dueDate: "2026-08-20T00:00:00.000Z", status: "TODO" })],
      capability,
      { nowMs },
    );
    expect(queue.has(reminderIdFor({ id: "t_1" }))).toBe(true);

    // Same task, now DONE — the reminder must actually be cancelled, not
    // just left un-renewed (the OS would otherwise still fire it).
    await reconcileTaskReminders(
      [task("t_1", { dueDate: "2026-08-20T00:00:00.000Z", status: "DONE" })],
      capability,
      { nowMs },
    );
    expect(queue.has(reminderIdFor({ id: "t_1" }))).toBe(false);
  });

  it("cancels a task's reminder once its due date is cleared", async () => {
    const { queue, capability } = createQueue();
    await reconcileTaskReminders(
      [task("t_1", { dueDate: "2026-08-20T00:00:00.000Z" })],
      capability,
    );
    expect(queue.has(reminderIdFor({ id: "t_1" }))).toBe(true);

    await reconcileTaskReminders([task("t_1", { dueDate: undefined })], capability);
    expect(queue.has(reminderIdFor({ id: "t_1" }))).toBe(false);
  });

  it("one bad task does not stop the rest of the batch from reconciling", async () => {
    const { queue, capability } = createQueue();
    const broken = task("t_broken", { dueDate: "2026-08-20T00:00:00.000Z" });
    const failingCapability: NotificationCapability = {
      ...capability,
      async scheduleNotification(input) {
        if (input.id === reminderIdFor(broken)) throw new Error("boom");
        return capability.scheduleNotification(input);
      },
    };

    await reconcileTaskReminders(
      [broken, task("t_ok", { dueDate: "2026-08-21T00:00:00.000Z" })],
      failingCapability,
    );

    expect(queue.has(reminderIdFor({ id: "t_ok" }))).toBe(true);
    expect(queue.has(reminderIdFor(broken))).toBe(false);
  });
});

describe("pruneOrphanTaskReminders", () => {
  it("cancels a task-reminder entry whose task has been deleted", async () => {
    const { queue, capability } = createQueue();
    await scheduleTaskReminder(
      task("t_deleted", { dueDate: "2026-08-20T00:00:00.000Z" }),
      capability,
    );
    expect(queue.size).toBe(1);

    // The deleted task is simply absent from the list — that's what "deleted" means here.
    await pruneOrphanTaskReminders([], capability);

    expect(queue.size).toBe(0);
  });

  it("leaves other notification families' entries alone", async () => {
    const { queue, capability } = createQueue();
    await capability.scheduleNotification({
      id: "schedule-reminder-b_1",
      title: "Deep work",
      body: "Starting now",
      repeat: { weekday: 1, hour: 6, minute: 0 },
    });
    await capability.scheduleNotification({
      id: "goalslot-journal-reminder",
      title: "Journal reminder",
      body: "...",
      fireAtUtc: new Date().toISOString(),
    });

    await pruneOrphanTaskReminders([], capability);

    expect(queue.has("schedule-reminder-b_1")).toBe(true);
    expect(queue.has("goalslot-journal-reminder")).toBe(true);
  });

  it("does not touch a still-eligible task's own entry", async () => {
    const { queue, capability } = createQueue();
    const t = task("t_1", { dueDate: "2026-08-20T00:00:00.000Z" });
    await scheduleTaskReminder(t, capability);

    await pruneOrphanTaskReminders([t], capability);

    expect(queue.has(reminderIdFor(t))).toBe(true);
  });
});
