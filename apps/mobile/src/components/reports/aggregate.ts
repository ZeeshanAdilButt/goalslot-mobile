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

const UNCATEGORIZED_KEY = "__uncategorized__";

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
