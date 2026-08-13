// Pure aggregation behind the Reports screen — period boundaries, per-day
// bucketing, category rollups and trend deltas. No React, no data fetching:
// the screen hands it entries and gets back chart-ready rows.
//
// This is the mobile equivalent of dw-time-web's
// features/reports/utils/{dates,aggregation}.ts. It is deliberately a much
// smaller surface: the web app has a granularity switcher, offset paging and
// filter state, whereas this screen offers "this week" and "this month" and
// nothing else (see the screen header for why Reports stays small on mobile).
//
// Every date comparison is done on `YYYY-MM-DD` strings produced by the
// shared package's `getLocalDateString`, never on parsed Date objects. Two
// reasons: `new Date("2026-08-10")` parses as UTC midnight and reads back as
// the previous day for anyone behind UTC (the exact bug that helper exists
// to prevent), and ISO date strings compare correctly with `<`/`>` as plain
// strings, so range checks need no date math at all.

import {
  DAYS_OF_WEEK,
  getLocalDateString,
  getReportingWeekDates,
  type Category,
  type TimeEntry,
} from "@goalslot/shared";

export type ReportPeriod = "week" | "month";

export interface PeriodRange {
  /** Inclusive `YYYY-MM-DD` bounds. */
  start: string;
  end: string;
}

export interface PeriodRanges {
  current: PeriodRange;
  previous: PeriodRange;
  /** Human label for the current window, e.g. "4 – 10 Aug". */
  label: string;
  /** Widest window the screen needs to fetch: previous.start through current.end. */
  fetch: PeriodRange;
}

export interface DayBucket {
  dateKey: string;
  /** Short label for the axis — weekday initial for a week, day-of-month for a month. */
  label: string;
  minutes: number;
  isToday: boolean;
  /** True for days later in the current period than today — nothing can have been logged yet. */
  isFuture: boolean;
}

export interface CategorySlice {
  key: string;
  name: string;
  minutes: number;
  color: string;
}

export type TrendDirection = "up" | "down" | "flat" | "new";

export interface Trend {
  direction: TrendDirection;
  /** Absolute percentage change vs the previous period. Meaningless when direction is "new". */
  percent: number;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  // Day 0 of the *next* month is the last day of this one.
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function formatRangeLabel(start: Date, end: Date, period: ReportPeriod): string {
  if (period === "month") {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const startLabel = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const endLabel = end.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${startLabel} – ${endLabel}`;
}

/**
 * Current and previous window for a period, plus the single combined range
 * the screen has to fetch to be able to show a real trend delta (you cannot
 * say "up 12% on last week" while only holding this week's entries).
 *
 * Week boundaries come from the shared package's `getReportingWeekDates`
 * (Monday-start), which is the app's canonical reporting week — not
 * hand-rolled here, and deliberately not the Sunday-start indexing the
 * Schedule feature uses. Months are calendar months.
 */
export function getPeriodRanges(period: ReportPeriod, now: Date = new Date()): PeriodRanges {
  if (period === "week") {
    const thisWeek = getReportingWeekDates(now);
    const priorAnchor = new Date(now);
    priorAnchor.setDate(priorAnchor.getDate() - 7);
    const lastWeek = getReportingWeekDates(priorAnchor);

    return {
      current: { start: getLocalDateString(thisWeek.start), end: getLocalDateString(thisWeek.end) },
      previous: { start: getLocalDateString(lastWeek.start), end: getLocalDateString(lastWeek.end) },
      label: formatRangeLabel(thisWeek.start, thisWeek.end, "week"),
      fetch: { start: getLocalDateString(lastWeek.start), end: getLocalDateString(thisWeek.end) },
    };
  }

  const currentStart = startOfMonth(now);
  const currentEnd = endOfMonth(now);
  const previousStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const previousEnd = endOfMonth(previousStart);

  return {
    current: { start: getLocalDateString(currentStart), end: getLocalDateString(currentEnd) },
    previous: { start: getLocalDateString(previousStart), end: getLocalDateString(previousEnd) },
    label: formatRangeLabel(currentStart, currentEnd, "month"),
    fetch: { start: getLocalDateString(previousStart), end: getLocalDateString(currentEnd) },
  };
}

/** Total logged minutes falling inside an inclusive date range. */
export function sumMinutesInRange(entries: TimeEntry[], range: PeriodRange): number {
  let total = 0;
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    if (key >= range.start && key <= range.end) total += entry.duration;
  }
  return total;
}

/**
 * One bucket per calendar day in `range`, in order, with zero-filled gaps —
 * a bar chart with holes in it reads as missing data rather than as days
 * with nothing logged.
 */
export function buildDayBuckets(entries: TimeEntry[], range: PeriodRange, period: ReportPeriod): DayBucket[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    if (key < range.start || key > range.end) continue;
    totals.set(key, (totals.get(key) ?? 0) + entry.duration);
  }

  const todayKey = getLocalDateString();
  const [startYear, startMonth, startDay] = range.start.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, startDay);

  const buckets: DayBucket[] = [];
  for (let guard = 0; guard < 400; guard++) {
    const key = getLocalDateString(cursor);
    if (key > range.end) break;
    buckets.push({
      dateKey: key,
      label: period === "week" ? DAYS_OF_WEEK[cursor.getDay()] : String(cursor.getDate()),
      minutes: totals.get(key) ?? 0,
      isToday: key === todayKey,
      isFuture: key > todayKey,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

/**
 * Turns a category token ("DEEP_WORK") into a display name ("Deep Work") —
 * the same normalisation dw-time-web's focus-category-pie-card.tsx applies
 * before charting, so the two platforms label the same slice identically.
 */
function humanizeCategory(raw: string): string {
  return raw
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Bucket key for time that has no category to roll up under — which, since
 * the Time Tracker stopped requiring a goal before you can start, means every
 * session the user tracked without attaching anything.
 *
 * Exported so the Reports screen can find that slice and say what it is. It
 * would otherwise render as an anonymous grey wedge indistinguishable from
 * the chart's "Other (N)" long-tail bucket, which is a bad way to learn that
 * a third of your week is unfiled. It is deliberately a sentinel that cannot
 * collide with a real category value: categories are matched lowercased, and
 * no category the user can create is wrapped in double underscores.
 */
export const UNCATEGORIZED_KEY = "__uncategorized__";

/**
 * Time-by-category rollup, largest slice first.
 *
 * Colours come from the user's own Category records (`Category.color`, the
 * same field the Categories screen renders its swatches from) matched on
 * `Category.value` — a real palette the user chose, not an invented one. A
 * category the API returned on an entry but that has no Category record
 * falls back to the goal colour carried on the entry itself, and only then
 * to a neutral.
 */
export function buildCategoryBreakdown(
  entries: TimeEntry[],
  range: PeriodRange,
  categories: Category[],
  neutralColor: string,
): CategorySlice[] {
  const byValue = new Map<string, Category>();
  for (const category of categories) {
    byValue.set(category.value.toLowerCase(), category);
    byValue.set(category.name.toLowerCase(), category);
  }

  const buckets = new Map<string, { minutes: number; fallbackColor: string | null; raw: string }>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    if (key < range.start || key > range.end) continue;

    const raw = entry.goal?.category ?? entry.scheduleBlock?.category ?? "";
    const bucketKey = raw ? raw.toLowerCase() : UNCATEGORIZED_KEY;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.minutes += entry.duration;
      existing.fallbackColor = existing.fallbackColor ?? entry.goal?.color ?? null;
    } else {
      buckets.set(bucketKey, {
        minutes: entry.duration,
        fallbackColor: entry.goal?.color ?? null,
        raw,
      });
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const match = key === UNCATEGORIZED_KEY ? undefined : byValue.get(key);
      return {
        key,
        name: match?.name ?? (bucket.raw ? humanizeCategory(bucket.raw) : "Uncategorized"),
        minutes: bucket.minutes,
        color: match?.color ?? bucket.fallbackColor ?? neutralColor,
      };
    })
    .filter((slice) => slice.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Time-by-goal rollup over a range, largest first.
 *
 * Returns the same `CategorySlice` shape `buildCategoryBreakdown` does on
 * purpose: every goal-level breakdown reuses `CategoryDonut` (colour swatch +
 * name + percent + duration rows) rather than inventing a second chart type
 * for "time by goal" when "time by category" already renders that pattern.
 *
 * Grouped by `goalId` rather than category — a day (or a whole period) can
 * hold several sessions against the same goal but different categories (or
 * none), and the ask this answers is "what did I actually work on", which is
 * a goal question, not a category one. Entries with no goal attached pool
 * into the same `UNCATEGORIZED_KEY` sentinel `buildCategoryBreakdown` uses,
 * for the same reason: unfiled time must stay visible, not disappear from
 * the report.
 */
export function buildGoalBreakdown(entries: TimeEntry[], range: PeriodRange, neutralColor: string): CategorySlice[] {
  const buckets = new Map<string, { minutes: number; name: string; color: string }>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    if (key < range.start || key > range.end) continue;

    const bucketKey = entry.goalId ?? UNCATEGORIZED_KEY;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.minutes += entry.duration;
    } else {
      buckets.set(bucketKey, {
        minutes: entry.duration,
        name: entry.goal?.title ?? "No goal",
        color: entry.goal?.color ?? neutralColor,
      });
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, name: bucket.name, minutes: bucket.minutes, color: bucket.color }))
    .filter((slice) => slice.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Single-day convenience wrapper around `buildGoalBreakdown` — the drill-down
 * shown when a bar in the "Focus per day" chart is tapped. Kept as its own
 * named function (rather than making every call site build a one-day range)
 * because "what did I work on Wednesday" is a distinct, common enough
 * question to read clearly at the call site.
 */
export function buildDayGoalBreakdown(entries: TimeEntry[], dateKey: string, neutralColor: string): CategorySlice[] {
  return buildGoalBreakdown(entries, { start: dateKey, end: dateKey }, neutralColor);
}

/**
 * Bucket key for a task-breakdown row with no real task behind it — either a
 * raw timer session with nothing selected, or (defensively) a `taskId` that
 * no longer matches a real task. Mirrors `UNCATEGORIZED_KEY`'s role one level
 * down: unfiled time must stay visible here too, not disappear because it
 * has nothing to group under.
 */
export const UNTITLED_TASK_KEY = "__untitled_task__";

/**
 * Time-by-task rollup for a single goal (or the "No goal" bucket) within a
 * range — the drill-down one level below `buildGoalBreakdown`, for "what did
 * I actually spend that goal's time on". This is the presentation gap the
 * Reports screen had: category and goal totals both existed, but nothing
 * broke either of them down to the task that consumed the time.
 *
 * `goalKey` is either a real `goalId` or the `UNCATEGORIZED_KEY` sentinel
 * `buildGoalBreakdown`/`buildCategoryBreakdown` use for entries with no goal
 * attached, so it composes directly with a slice returned by either of those
 * — the caller doesn't need a separate "was this the uncategorized bucket"
 * branch to call this.
 *
 * Grouped by `taskId`, not by `taskName` — two different tasks can happen to
 * share a title, and the entry's `taskId` is what actually identifies "the
 * same task" the way the Tasks screen would. Name prefers `taskTitle` (the
 * canonical title snapshotted onto the entry) over the free-text `taskName`
 * a one-tap timer session with nothing selected carries instead — same
 * fallback `SessionHistory.tsx`'s row title uses, for the same entries.
 */
export function buildTaskBreakdown(
  entries: TimeEntry[],
  range: PeriodRange,
  goalKey: string,
  neutralColor: string,
): CategorySlice[] {
  const buckets = new Map<string, { minutes: number; name: string; color: string }>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    if (key < range.start || key > range.end) continue;
    if ((entry.goalId ?? UNCATEGORIZED_KEY) !== goalKey) continue;

    const bucketKey = entry.taskId ?? UNTITLED_TASK_KEY;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.minutes += entry.duration;
    } else {
      buckets.set(bucketKey, {
        minutes: entry.duration,
        name: entry.taskTitle || entry.taskName || "Untitled session",
        color: entry.goal?.color ?? neutralColor,
      });
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, name: bucket.name, minutes: bucket.minutes, color: bucket.color }))
    .filter((slice) => slice.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * Period-over-period change. A jump from nothing to something is reported as
 * "new" rather than as an infinite percentage.
 */
export function computeTrend(current: number, previous: number): Trend {
  if (previous === 0) {
    return current > 0 ? { direction: "new", percent: 0 } : { direction: "flat", percent: 0 };
  }
  const change = ((current - previous) / previous) * 100;
  const percent = Math.round(Math.abs(change));
  if (percent === 0) return { direction: "flat", percent: 0 };
  return { direction: change > 0 ? "up" : "down", percent };
}
