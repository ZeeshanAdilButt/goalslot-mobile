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
  computeTrend,
  getPeriodRanges,
  sumMinutesInRange,
  UNCATEGORIZED_KEY,
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
