// Regression coverage for the duplicated-schedule-blocks report: even after
// the confirmed data-layer causes are fixed (midnight-wrapped time ranges
// evading checkTimeConflict; restoreBlocks replaying under a fresh
// idempotency key — see quick-add-slot-times.ts), this is the last line of
// defense against a block id rendering twice.

import type { ScheduleBlock, WeekSchedule } from "@goalslot/shared";

import { dedupeWeekSchedule } from "./dedupe-week-schedule";

function block(overrides: Partial<ScheduleBlock> & { id: string }): ScheduleBlock {
  return {
    title: "Reading",
    startTime: "06:00",
    endTime: "07:00",
    dayOfWeek: 1,
    category: "Growth",
    color: "#FFD700",
    isRecurring: true,
    isPrivate: false,
    seriesId: `series-${overrides.id}`,
    ...overrides,
  } as ScheduleBlock;
}

describe("dedupeWeekSchedule", () => {
  it("passes undefined through untouched", () => {
    expect(dedupeWeekSchedule(undefined)).toBeUndefined();
  });

  it("leaves a week with no duplicate ids unchanged", () => {
    const week: WeekSchedule = {
      1: [block({ id: "a" }), block({ id: "b" })],
    };

    expect(dedupeWeekSchedule(week)).toEqual(week);
  });

  it("drops a repeated id within the same day, keeping one copy", () => {
    const dup = block({ id: "a", title: "Reading (refetched)" });
    const week: WeekSchedule = {
      1: [block({ id: "a" }), block({ id: "b" }), dup],
    };

    const result = dedupeWeekSchedule(week);

    expect(result?.[1].map((b) => b.id)).toEqual(["a", "b"]);
    // Keeps the LAST occurrence — the one most likely to be the fresher copy.
    expect(result?.[1][0].title).toBe("Reading (refetched)");
  });

  it("dedupes each day independently, never across days", () => {
    const week: WeekSchedule = {
      1: [block({ id: "a" })],
      2: [block({ id: "a", dayOfWeek: 2 })],
    };

    const result = dedupeWeekSchedule(week);

    expect(result?.[1].map((b) => b.id)).toEqual(["a"]);
    expect(result?.[2].map((b) => b.id)).toEqual(["a"]);
  });

  it("handles an empty week", () => {
    expect(dedupeWeekSchedule({})).toEqual({});
  });
});
