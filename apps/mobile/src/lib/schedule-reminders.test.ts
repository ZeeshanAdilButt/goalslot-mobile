// Cancellation is the half of this feature that has to be right.
//
// A schedule alarm is a WEEKLY, indefinite entry in the OS queue. Once handed
// over it fires whether or not the app still agrees with it, so "stopped
// scheduling it" and "cancelled it" are completely different outcomes: the
// first leaves the user's phone going off every week for something they
// explicitly silenced or deleted. These tests run against a modelled OS queue
// rather than assertion-counting, so they fail if a reminder is merely
// skipped instead of actually removed.

import type { NotificationCapability, NotificationInput, ScheduleBlock } from "@goalslot/shared";

import {
  cancelBlockReminders,
  pruneOrphanReminders,
  reconcileBlockReminders,
  reminderIdFor,
  scheduleBlockReminder,
} from "./schedule-reminders";

function block(id: string, overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id,
    title: `Block ${id}`,
    startTime: "06:00",
    endTime: "07:00",
    dayOfWeek: 1,
    category: "Focus",
    color: "#FFD700",
    isRecurring: true,
    isPrivate: false,
    seriesId: "series-1",
    ...overrides,
  } as ScheduleBlock;
}

/**
 * Stands in for the OS's pending-notification queue. `scheduleNotification`
 * overwrites by identifier, exactly like expo-notifications does, so a
 * duplicate-scheduling bug shows up as a single entry rather than being
 * hidden by a call-count assertion.
 */
function createQueue() {
  const queue = new Map<string, NotificationInput>();
  const capability: NotificationCapability = {
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

describe("scheduleBlockReminder", () => {
  it("asks for an ALARM, not a quiet notice", async () => {
    const { queue, capability } = createQueue();

    await scheduleBlockReminder(block("a"), capability);

    // Without this flag the platform layer produces a silent shade entry —
    // the original "alarms not working" bug. See notifications.ts.
    expect(queue.get(reminderIdFor({ id: "a" }))?.alarm).toBe(true);
  });

  it("repeats weekly on the block's own day and start time", async () => {
    const { queue, capability } = createQueue();

    await scheduleBlockReminder(block("a", { dayOfWeek: 4, startTime: "18:30" }), capability);

    expect(queue.get(reminderIdFor({ id: "a" }))?.repeat).toEqual({
      weekday: 4,
      hour: 18,
      minute: 30,
    });
  });

  it("re-scheduling the same block replaces its entry rather than stacking one", async () => {
    const { queue, capability } = createQueue();

    await scheduleBlockReminder(block("a", { startTime: "06:00" }), capability);
    await scheduleBlockReminder(block("a", { startTime: "09:15" }), capability);

    expect(queue.size).toBe(1);
    expect(queue.get(reminderIdFor({ id: "a" }))?.repeat?.hour).toBe(9);
  });
});

describe("reconcileBlockReminders", () => {
  it("CANCELS a block that is switched off, rather than just not scheduling it", async () => {
    const { queue, capability } = createQueue();
    const blocks = [block("a"), block("b")];
    await reconcileBlockReminders(blocks, () => true, capability);
    expect(queue.size).toBe(2);

    // "b" is now switched off.
    await reconcileBlockReminders(blocks, (b) => b.id !== "b", capability);

    expect(Array.from(queue.keys())).toEqual([reminderIdFor({ id: "a" })]);
  });

  it("keeps going after one block fails, so a single bad id can't silence the week", async () => {
    const { queue, capability } = createQueue();
    const failing: NotificationCapability = {
      ...capability,
      async scheduleNotification(input) {
        if (input.id === reminderIdFor({ id: "b" })) throw new Error("nope");
        await capability.scheduleNotification(input);
      },
    };

    await reconcileBlockReminders([block("a"), block("b"), block("c")], () => true, failing);

    expect(Array.from(queue.keys())).toEqual([reminderIdFor({ id: "a" }), reminderIdFor({ id: "c" })]);
  });
});

describe("cancelBlockReminders", () => {
  it("empties the queue for exactly the blocks given", async () => {
    const { queue, capability } = createQueue();
    await reconcileBlockReminders([block("a"), block("b"), block("c")], () => true, capability);

    await cancelBlockReminders([block("a"), block("c")], capability);

    expect(Array.from(queue.keys())).toEqual([reminderIdFor({ id: "b" })]);
  });

  it("does not throw when the platform refuses — a switch must still move", async () => {
    const { capability } = createQueue();
    const failing: NotificationCapability = {
      ...capability,
      async cancelNotification() {
        throw new Error("platform said no");
      },
    };

    await expect(cancelBlockReminders([block("a")], failing)).resolves.toBeUndefined();
  });
});

describe("pruneOrphanReminders", () => {
  it("cancels a reminder whose block no longer exists", async () => {
    const { queue, capability } = createQueue();
    await reconcileBlockReminders([block("a"), block("deleted")], () => true, capability);

    // "deleted" is gone — removed here, or on the web, or on another device.
    await pruneOrphanReminders([block("a")], capability);

    expect(Array.from(queue.keys())).toEqual([reminderIdFor({ id: "a" })]);
  });

  it("leaves notifications belonging to other features strictly alone", async () => {
    const { queue, capability } = createQueue();
    await reconcileBlockReminders([block("a")], () => true, capability);
    // The timer's ongoing entry and a tracking reminder share the queue.
    await capability.scheduleNotification({
      id: "goalslot-timer-session",
      title: "Tracking",
      body: "",
      fireAtUtc: new Date().toISOString(),
    });
    await capability.scheduleNotification({
      id: "timer-reminder-1",
      title: "Time Check",
      body: "",
      fireAtUtc: new Date().toISOString(),
    });

    await pruneOrphanReminders([block("a")], capability);

    expect(Array.from(queue.keys()).sort()).toEqual([
      "goalslot-timer-session",
      reminderIdFor({ id: "a" }),
      "timer-reminder-1",
    ]);
  });

  it("degrades to leaving the queue alone when the OS can't be listed", async () => {
    const { queue, capability } = createQueue();
    await reconcileBlockReminders([block("a")], () => true, capability);
    const blind: NotificationCapability = {
      ...capability,
      async listScheduledIds() {
        throw new Error("unavailable");
      },
    };

    await expect(pruneOrphanReminders([block("a")], blind)).resolves.toBeUndefined();
    expect(queue.size).toBe(1);
  });
});
