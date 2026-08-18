// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see task-reminders.test.ts and journal-reminders.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via
// tsconfig.json's `exclude`.
//
// Cancellation/pruning is the half of this feature that has to be right, for
// the same reason task-reminders.test.ts's header explains: a queued digest
// fires whether or not the app still agrees with it, so "stopped scheduling
// it" and "actually cancelled it" are different outcomes. These tests run
// against a modelled OS queue rather than assertion-counting.

import type { NotificationCapability, NotificationInput, Task } from "@goalslot/shared";

import {
  DEFAULT_TASK_DIGEST_HOURS,
  TASK_DIGEST_ID_PREFIX,
  cancelTaskDigestReminder,
  countDueTodayTasks,
  describeTaskDigest,
  isTaskDueTodayForDigest,
  normalizeTaskDigestHours,
  pruneOrphanTaskDigestReminders,
  reconcileTaskDigestReminders,
  scheduleTaskDigestReminder,
  taskDigestFireTimeToday,
  taskDigestIdFor,
} from "./task-digest-reminders";

const TODAY = "2026-08-18";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "TODO",
    dueDate: `${TODAY}T00:00:00.000Z`,
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

describe("taskDigestIdFor", () => {
  it("is stable and namespaced under the task-digest prefix", () => {
    expect(taskDigestIdFor(9)).toBe(`${TASK_DIGEST_ID_PREFIX}9`);
    expect(taskDigestIdFor(9)).toBe(taskDigestIdFor(9));
  });
});

describe("normalizeTaskDigestHours", () => {
  it("filters to integers 0-23, dedupes, and sorts ascending", () => {
    expect(normalizeTaskDigestHours([18, 9, 9, 13, 13.5, -1, 24, "9" as unknown as number])).toEqual([9, 13, 18]);
  });

  it("falls back to the default set when the result would be empty", () => {
    expect(normalizeTaskDigestHours([])).toEqual(DEFAULT_TASK_DIGEST_HOURS);
    expect(normalizeTaskDigestHours([-1, 24, 100])).toEqual(DEFAULT_TASK_DIGEST_HOURS);
    expect(normalizeTaskDigestHours(undefined)).toEqual(DEFAULT_TASK_DIGEST_HOURS);
    expect(normalizeTaskDigestHours(null)).toEqual(DEFAULT_TASK_DIGEST_HOURS);
    expect(normalizeTaskDigestHours("not an array")).toEqual(DEFAULT_TASK_DIGEST_HOURS);
  });

  it("keeps a single valid hour rather than falling back", () => {
    expect(normalizeTaskDigestHours([6])).toEqual([6]);
  });
});

describe("isTaskDueTodayForDigest", () => {
  it("is true for a TODO/DOING/BACKLOG task due today", () => {
    for (const status of ["BACKLOG", "TODO", "DOING"] as const) {
      expect(isTaskDueTodayForDigest({ status, dueDate: `${TODAY}T00:00:00.000Z` }, TODAY)).toBe(true);
    }
  });

  it("is false once the task is DONE, even if due today", () => {
    expect(isTaskDueTodayForDigest({ status: "DONE", dueDate: `${TODAY}T00:00:00.000Z` }, TODAY)).toBe(false);
  });

  it("is false for a task due on a different day", () => {
    expect(isTaskDueTodayForDigest({ status: "TODO", dueDate: "2026-08-20T00:00:00.000Z" }, TODAY)).toBe(false);
  });

  it("is false with no due date at all", () => {
    expect(isTaskDueTodayForDigest({ status: "TODO", dueDate: undefined }, TODAY)).toBe(false);
  });

  it("is false for an unparseable due date", () => {
    expect(isTaskDueTodayForDigest({ status: "TODO", dueDate: "not-a-date" }, TODAY)).toBe(false);
  });
});

describe("countDueTodayTasks", () => {
  it("counts only eligible tasks due today", () => {
    const tasks = [
      task("t_1"),
      task("t_2"),
      task("t_done", { status: "DONE" }),
      task("t_other_day", { dueDate: "2026-08-20T00:00:00.000Z" }),
      task("t_undated", { dueDate: undefined }),
    ];
    expect(countDueTodayTasks(tasks, TODAY)).toBe(2);
  });

  it("is zero for an empty list", () => {
    expect(countDueTodayTasks([], TODAY)).toBe(0);
  });
});

describe("describeTaskDigest", () => {
  it("uses singular phrasing for exactly one task", () => {
    expect(describeTaskDigest(1).body).toBe("You have 1 task due today");
  });

  it("uses plural phrasing for any other count", () => {
    expect(describeTaskDigest(3).body).toBe("You have 3 tasks due today");
    expect(describeTaskDigest(0).body).toBe("You have 0 tasks due today");
  });
});

describe("taskDigestFireTimeToday", () => {
  it("lands at hourOfDay:00 today, local time, regardless of whether it's already passed", () => {
    const nowMs = Date.parse("2026-08-18T14:00:00");
    const morning = taskDigestFireTimeToday({ hourOfDay: 9, nowMs });
    const d = new Date(morning);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    // Already in the past relative to nowMs — this function doesn't care.
    expect(morning).toBeLessThan(nowMs);
  });
});

describe("scheduleTaskDigestReminder", () => {
  it("schedules a one-shot digest notification with the right copy", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T06:00:00");

    await scheduleTaskDigestReminder({ hourOfDay: 9, count: 3, nowMs }, capability);

    const entry = queue.get(taskDigestIdFor(9));
    expect(entry).toBeDefined();
    expect(entry?.body).toBe("You have 3 tasks due today");
    expect(entry?.fireAtUtc).toBeDefined();
    // One-shot, not a repeating trigger — see the module header for why.
    expect(entry?.repeat).toBeUndefined();
  });

  it("overwrites rather than stacking a duplicate entry for the same hour", async () => {
    const { queue, capability } = createQueue();
    await scheduleTaskDigestReminder({ hourOfDay: 9, count: 1 }, capability);
    await scheduleTaskDigestReminder({ hourOfDay: 9, count: 5 }, capability);

    expect(queue.size).toBe(1);
    expect(queue.get(taskDigestIdFor(9))?.body).toBe("You have 5 tasks due today");
  });
});

describe("cancelTaskDigestReminder", () => {
  it("removes that hour's entry from the OS queue", async () => {
    const { queue, capability } = createQueue();
    await scheduleTaskDigestReminder({ hourOfDay: 9, count: 1 }, capability);
    expect(queue.size).toBe(1);

    await cancelTaskDigestReminder(9, capability);

    expect(queue.size).toBe(0);
  });
});

describe("reconcileTaskDigestReminders", () => {
  it("arms every configured hour whose slot is still ahead, when enabled with tasks due today", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T06:00:00"); // before 9am, 1pm, 6pm

    await reconcileTaskDigestReminders(
      { tasks: [task("t_1"), task("t_2")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );

    expect(queue.has(taskDigestIdFor(9))).toBe(true);
    expect(queue.has(taskDigestIdFor(13))).toBe(true);
    expect(queue.has(taskDigestIdFor(18))).toBe(true);
    expect(queue.get(taskDigestIdFor(9))?.body).toBe("You have 2 tasks due today");
  });

  it("skips (and does not schedule for tomorrow) an hour whose slot has already passed today", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T11:00:00"); // after 9am, before 1pm/6pm

    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );

    expect(queue.has(taskDigestIdFor(9))).toBe(false);
    expect(queue.has(taskDigestIdFor(13))).toBe(true);
    expect(queue.has(taskDigestIdFor(18))).toBe(true);
  });

  it("cancels a stale entry for an hour that has now passed, rather than leaving it queued", async () => {
    const { queue, capability } = createQueue();
    // First pass: morning, 9am slot armed.
    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs: Date.parse("2026-08-18T06:00:00") },
      capability,
    );
    expect(queue.has(taskDigestIdFor(9))).toBe(true);

    // Second pass: now afternoon, 9am has passed.
    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs: Date.parse("2026-08-18T14:00:00") },
      capability,
    );
    expect(queue.has(taskDigestIdFor(9))).toBe(false);
  });

  it("cancels every configured hour when disabled", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T06:00:00");
    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );
    expect(queue.size).toBe(3);

    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: false, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );

    expect(queue.size).toBe(0);
  });

  it("cancels every configured hour when nothing is due today", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T06:00:00");
    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );
    expect(queue.size).toBe(3);

    await reconcileTaskDigestReminders(
      { tasks: [task("t_done", { status: "DONE" })], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );

    expect(queue.size).toBe(0);
  });

  it("cancels an hour's entry once that hour is removed from the configured set", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T06:00:00");
    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      capability,
    );
    expect(queue.has(taskDigestIdFor(13))).toBe(true);

    // User removed the 1pm slot from settings.
    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 18], todayStr: TODAY, nowMs },
      capability,
    );

    expect(queue.has(taskDigestIdFor(13))).toBe(false);
    expect(queue.has(taskDigestIdFor(9))).toBe(true);
    expect(queue.has(taskDigestIdFor(18))).toBe(true);
  });

  it("one bad hour does not stop the rest of the batch from reconciling", async () => {
    const { queue, capability } = createQueue();
    const nowMs = Date.parse("2026-08-18T06:00:00");
    const failingCapability: NotificationCapability = {
      ...capability,
      async scheduleNotification(input) {
        if (input.id === taskDigestIdFor(13)) throw new Error("boom");
        return capability.scheduleNotification(input);
      },
    };

    await reconcileTaskDigestReminders(
      { tasks: [task("t_1")], enabled: true, hours: [9, 13, 18], todayStr: TODAY, nowMs },
      failingCapability,
    );

    expect(queue.has(taskDigestIdFor(9))).toBe(true);
    expect(queue.has(taskDigestIdFor(18))).toBe(true);
    expect(queue.has(taskDigestIdFor(13))).toBe(false);
  });
});

describe("pruneOrphanTaskDigestReminders", () => {
  it("cancels a task-digest entry for an hour no longer configured", async () => {
    const { queue, capability } = createQueue();
    await scheduleTaskDigestReminder({ hourOfDay: 9, count: 1 }, capability);
    await scheduleTaskDigestReminder({ hourOfDay: 13, count: 1 }, capability);

    await pruneOrphanTaskDigestReminders([9], capability);

    expect(queue.has(taskDigestIdFor(9))).toBe(true);
    expect(queue.has(taskDigestIdFor(13))).toBe(false);
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

    await pruneOrphanTaskDigestReminders([], capability);

    expect(queue.has("schedule-reminder-b_1")).toBe(true);
    expect(queue.has("goalslot-journal-reminder")).toBe(true);
  });
});
