// Unit cover for the Reports screen's pure aggregation layer.
//
// This is the part of Reports that can be wrong silently: a bad denominator
// or an off-by-one range bound produces a plausible-looking number, not a
// crash. The cases below are the ones that were reasoned about but never
// pinned down — divide-by-zero in the period-over-period delta, and the
// `YYYY-MM-DD` string comparisons the module deliberately uses instead of
// Date math (see its header for why).

import {
  buildCategoryBreakdown,
  buildDayBuckets,
  buildDayGoalBreakdown,
  buildTaskBreakdown,
  computeTrend,
  getPeriodRanges,
  sumMinutesInRange,
  UNCATEGORIZED_KEY,
  UNTITLED_TASK_KEY,
} from "./aggregate";

import type { Category, TimeEntry } from "@goalslot/shared";

function entry(date: string, duration: number): TimeEntry {
  return { id: `${date}-${duration}`, date, duration } as TimeEntry;
}

describe("computeTrend", () => {
  it("reports a jump from zero as 'new' rather than an infinite percentage", () => {
    expect(computeTrend(120, 0)).toEqual({ direction: "new", percent: 0 });
  });

  it("treats zero-to-zero as flat, not new", () => {
    expect(computeTrend(0, 0)).toEqual({ direction: "flat", percent: 0 });
  });

  it("reports a drop to zero as a full 100% decrease", () => {
    expect(computeTrend(0, 60)).toEqual({ direction: "down", percent: 100 });
  });

  it("rounds sub-1% movement to flat instead of showing '0%' with an arrow", () => {
    expect(computeTrend(1002, 1000)).toEqual({ direction: "flat", percent: 0 });
  });

  it("returns the absolute magnitude, with direction carried separately", () => {
    expect(computeTrend(50, 100)).toEqual({ direction: "down", percent: 50 });
    expect(computeTrend(150, 100)).toEqual({ direction: "up", percent: 50 });
  });
});

describe("sumMinutesInRange", () => {
  const entries = [entry("2026-08-09", 30), entry("2026-08-10", 45), entry("2026-08-16", 60)];

  it("includes both range endpoints", () => {
    expect(sumMinutesInRange(entries, { start: "2026-08-10", end: "2026-08-16" })).toBe(105);
  });

  it("excludes days outside the range", () => {
    expect(sumMinutesInRange(entries, { start: "2026-08-10", end: "2026-08-15" })).toBe(45);
  });

  it("ignores the time component of a full ISO timestamp", () => {
    // The API returns `date` as an ISO datetime in some payloads; the module
    // slices to the day key rather than parsing, which is what keeps a late
    // evening entry from rolling into the next UTC day.
    expect(sumMinutesInRange([entry("2026-08-10T23:30:00.000Z", 25)], { start: "2026-08-10", end: "2026-08-10" })).toBe(
      25,
    );
  });
});

describe("buildCategoryBreakdown", () => {
  // A session tracked with nothing attached — the shape the Time Tracker now
  // produces whenever the user just presses start. It must still be counted.
  function unattributed(date: string, duration: number): TimeEntry {
    return { id: `u-${date}-${duration}`, date, duration } as TimeEntry;
  }

  function attributed(date: string, duration: number, category: string, color = "#123456"): TimeEntry {
    return {
      id: `a-${date}-${duration}-${category}`,
      date,
      duration,
      goal: { id: `goal-${category}`, title: category, color, category },
    } as TimeEntry;
  }

  const range = { start: "2026-08-10", end: "2026-08-16" };
  const categories: Category[] = [{ value: "work", name: "Deep Work", color: "#ff0000" } as Category];
  const neutral = "#999999";

  it("counts an entry with no goal instead of dropping it", () => {
    // The bug this guards is silent: time that saves fine, then vanishes from
    // the user's own report because it had nothing to group under.
    const slices = buildCategoryBreakdown([unattributed("2026-08-11", 45)], range, categories, neutral);
    expect(slices).toHaveLength(1);
    expect(slices[0].minutes).toBe(45);
  });

  it("files unattributed time under a stable, identifiable key", () => {
    // The Reports screen looks this key up by name to caption the slice.
    const slices = buildCategoryBreakdown([unattributed("2026-08-11", 45)], range, categories, neutral);
    expect(slices[0].key).toBe(UNCATEGORIZED_KEY);
    expect(slices[0].name).toBe("Uncategorized");
    expect(slices[0].color).toBe(neutral);
  });

  it("pools every unattributed entry into one slice rather than one each", () => {
    const slices = buildCategoryBreakdown(
      [unattributed("2026-08-11", 30), unattributed("2026-08-12", 20)],
      range,
      categories,
      neutral,
    );
    expect(slices).toHaveLength(1);
    expect(slices[0].minutes).toBe(50);
  });

  it("keeps attributed and unattributed time in separate slices, largest first", () => {
    const slices = buildCategoryBreakdown(
      [unattributed("2026-08-11", 30), attributed("2026-08-11", 90, "work")],
      range,
      categories,
      neutral,
    );
    expect(slices.map((slice) => [slice.name, slice.minutes])).toEqual([
      ["Deep Work", 90],
      ["Uncategorized", 30],
    ]);
  });

  it("still honours the range bounds for unattributed entries", () => {
    const slices = buildCategoryBreakdown([unattributed("2026-08-20", 45)], range, categories, neutral);
    expect(slices).toEqual([]);
  });

  it("falls back to the schedule block's category when the entry has no goal", () => {
    const fromBlock = {
      id: "sb",
      date: "2026-08-11",
      duration: 25,
      scheduleBlock: { id: "b1", title: "Standup", category: "work" },
    } as TimeEntry;
    const slices = buildCategoryBreakdown([fromBlock], range, categories, neutral);
    expect(slices[0].name).toBe("Deep Work");
  });
});

describe("buildDayGoalBreakdown", () => {
  const neutral = "#999999";

  function withGoal(date: string, duration: number, goalId: string, title: string, color = "#ff0000"): TimeEntry {
    return {
      id: `${goalId}-${date}-${duration}`,
      date,
      duration,
      goalId,
      goal: { id: goalId, title, color },
    } as TimeEntry;
  }

  function noGoal(date: string, duration: number): TimeEntry {
    return { id: `none-${date}-${duration}`, date, duration } as TimeEntry;
  }

  it("only counts entries on the requested day", () => {
    const slices = buildDayGoalBreakdown(
      [withGoal("2026-08-11", 30, "g1", "Reading"), withGoal("2026-08-12", 45, "g1", "Reading")],
      "2026-08-11",
      neutral,
    );
    expect(slices).toEqual([{ key: "g1", name: "Reading", minutes: 30, color: "#ff0000" }]);
  });

  it("keeps two goals tracked the same day as separate slices, largest first", () => {
    const slices = buildDayGoalBreakdown(
      [
        withGoal("2026-08-11", 20, "g1", "Reading"),
        withGoal("2026-08-11", 50, "g2", "Deep Work", "#00ff00"),
      ],
      "2026-08-11",
      neutral,
    );
    expect(slices.map((slice) => [slice.name, slice.minutes])).toEqual([
      ["Deep Work", 50],
      ["Reading", 20],
    ]);
  });

  it("sums repeat sessions against the same goal that day into one slice", () => {
    const slices = buildDayGoalBreakdown(
      [withGoal("2026-08-11", 20, "g1", "Reading"), withGoal("2026-08-11", 10, "g1", "Reading")],
      "2026-08-11",
      neutral,
    );
    expect(slices).toHaveLength(1);
    expect(slices[0].minutes).toBe(30);
  });

  it("pools time with no goal under the same UNCATEGORIZED_KEY sentinel the category breakdown uses", () => {
    const slices = buildDayGoalBreakdown([noGoal("2026-08-11", 25)], "2026-08-11", neutral);
    expect(slices).toEqual([{ key: UNCATEGORIZED_KEY, name: "No goal", minutes: 25, color: neutral }]);
  });

  it("returns nothing for a day with no tracked time", () => {
    expect(buildDayGoalBreakdown([withGoal("2026-08-11", 30, "g1", "Reading")], "2026-08-12", neutral)).toEqual([]);
  });
});

describe("buildTaskBreakdown", () => {
  const neutral = "#999999";
  const range = { start: "2026-08-10", end: "2026-08-16" };

  function withTask(
    date: string,
    duration: number,
    goalId: string,
    taskId: string,
    taskTitle: string,
  ): TimeEntry {
    return {
      id: `${goalId}-${taskId}-${date}-${duration}`,
      date,
      duration,
      goalId,
      taskId,
      taskTitle,
      taskName: taskTitle,
      goal: { id: goalId, title: "Goal", color: "#ff0000" },
    } as TimeEntry;
  }

  it("only counts entries against the requested goal", () => {
    const slices = buildTaskBreakdown(
      [
        withTask("2026-08-11", 30, "g1", "t1", "Read chapter 1"),
        withTask("2026-08-11", 45, "g2", "t2", "Unrelated task"),
      ],
      range,
      "g1",
      neutral,
    );
    expect(slices).toEqual([{ key: "t1", name: "Read chapter 1", minutes: 30, color: "#ff0000" }]);
  });

  it("sums repeat sessions against the same task into one slice", () => {
    const slices = buildTaskBreakdown(
      [
        withTask("2026-08-11", 20, "g1", "t1", "Read chapter 1"),
        withTask("2026-08-12", 10, "g1", "t1", "Read chapter 1"),
      ],
      range,
      "g1",
      neutral,
    );
    expect(slices).toHaveLength(1);
    expect(slices[0].minutes).toBe(30);
  });

  it("keeps two tasks under the same goal as separate slices, largest first", () => {
    const slices = buildTaskBreakdown(
      [
        withTask("2026-08-11", 20, "g1", "t1", "Read chapter 1"),
        withTask("2026-08-11", 50, "g1", "t2", "Write notes"),
      ],
      range,
      "g1",
      neutral,
    );
    expect(slices.map((slice) => [slice.name, slice.minutes])).toEqual([
      ["Write notes", 50],
      ["Read chapter 1", 20],
    ]);
  });

  it("prefers taskTitle over the free-text taskName", () => {
    const entry = {
      id: "e1",
      date: "2026-08-11",
      duration: 30,
      goalId: "g1",
      taskId: "t1",
      taskTitle: "Canonical title",
      taskName: "raw session label",
      goal: { id: "g1", title: "Goal", color: "#ff0000" },
    } as TimeEntry;
    const slices = buildTaskBreakdown([entry], range, "g1", neutral);
    expect(slices[0].name).toBe("Canonical title");
  });

  it("falls back to taskName when there is no taskTitle", () => {
    const entry = {
      id: "e1",
      date: "2026-08-11",
      duration: 30,
      goalId: "g1",
      taskName: "raw session label",
      goal: { id: "g1", title: "Goal", color: "#ff0000" },
    } as TimeEntry;
    const slices = buildTaskBreakdown([entry], range, "g1", neutral);
    expect(slices[0].key).toBe(UNTITLED_TASK_KEY);
    expect(slices[0].name).toBe("raw session label");
  });

  it("groups entries with no goal under UNCATEGORIZED_KEY, same as buildGoalBreakdown", () => {
    const entry = {
      id: "e1",
      date: "2026-08-11",
      duration: 30,
      taskId: "t1",
      taskTitle: "Freeform session",
    } as TimeEntry;
    const slices = buildTaskBreakdown([entry], range, UNCATEGORIZED_KEY, neutral);
    expect(slices).toEqual([{ key: "t1", name: "Freeform session", minutes: 30, color: neutral }]);
  });

  it("respects the range bounds", () => {
    const slices = buildTaskBreakdown(
      [withTask("2026-08-20", 30, "g1", "t1", "Read chapter 1")],
      range,
      "g1",
      neutral,
    );
    expect(slices).toEqual([]);
  });
});

describe("buildDayBuckets", () => {
  it("zero-fills every day in the range, in order", () => {
    const buckets = buildDayBuckets([entry("2026-08-11", 90)], { start: "2026-08-10", end: "2026-08-14" }, "week");
    expect(buckets.map((bucket) => bucket.dateKey)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
    expect(buckets.map((bucket) => bucket.minutes)).toEqual([0, 90, 0, 0, 0]);
  });

  it("walks across a month boundary without repeating or skipping a day", () => {
    const buckets = buildDayBuckets([], { start: "2026-08-30", end: "2026-09-02" }, "month");
    expect(buckets.map((bucket) => bucket.dateKey)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("sums multiple entries landing on the same day", () => {
    const buckets = buildDayBuckets(
      [entry("2026-08-10", 30), entry("2026-08-10", 15)],
      { start: "2026-08-10", end: "2026-08-10" },
      "week",
    );
    expect(buckets[0].minutes).toBe(45);
  });
});

describe("getPeriodRanges", () => {
  it("covers the current and previous window in a single fetch range", () => {
    const ranges = getPeriodRanges("week", new Date(2026, 7, 12));
    expect(ranges.fetch.start).toBe(ranges.previous.start);
    expect(ranges.fetch.end).toBe(ranges.current.end);
    expect(ranges.previous.end < ranges.current.start).toBe(true);
  });

  it("uses whole calendar months for the month period", () => {
    const ranges = getPeriodRanges("month", new Date(2026, 7, 12));
    expect(ranges.current).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(ranges.previous).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  });

  it("steps back to December when the anchor is in January", () => {
    const ranges = getPeriodRanges("month", new Date(2026, 0, 5));
    expect(ranges.previous).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("handles a 29-day February in a leap year", () => {
    const ranges = getPeriodRanges("month", new Date(2028, 1, 15));
    expect(ranges.current.end).toBe("2028-02-29");
  });
});
