// Geometry for the Schedule screen's time axis.
//
// WHY a positioned canvas instead of the flat agenda list this screen used to
// render: the web app's schedule IS a time axis, not a list — see
// dw-time-web/src/features/schedule/components/schedule-grid/schedule-grid.tsx
// (`top = (startMin - DAY_START_MIN) * PX_PER_MIN`, `height = (endMin -
// startMin) * PX_PER_MIN`) and .../schedule-grid/day-column.tsx (an hour rule
// per hour). That proportional placement is the whole reason a 15-minute
// block reads as short and a 3-hour block reads as long; a row list flattens
// that information away, which is why the previous version of this screen
// read as "a list that happens to mention times" rather than a schedule.
//
// WHY the window is always the full 00:00-24:00 day, matching the web's
// DAY_START_MIN/DAY_END_MIN: an earlier version trimmed this to ±1hr around
// the day's real content, on the reasoning that the full 24 hours is ~1600px
// of mostly-empty scrolling on a phone. That traded away something users
// actually wanted — "I need to be able to see all 24 hours" — for a
// convenience the auto-scroll-to-now behaviour (schedule.tsx's
// `pendingScrollY`/`landedDay`) already provides without it: the screen
// lands on the relevant time on open, so showing the full day doesn't cost
// an extra scroll for the common case, it just stops hiding the hours
// outside whatever happened to be scheduled.

import { timeToMinutes, type ScheduleBlock } from "@goalslot/shared";

/**
 * Vertical scale. The web uses PX_PER_MIN = 1 on a desktop canvas
 * (features/schedule/utils/constants.ts); 1.1 here buys back the legibility a
 * ~44pt minimum touch target needs without inflating the scroll length much.
 */
export const PX_PER_MIN = 1.1;
export const HOUR_HEIGHT = 60 * PX_PER_MIN;

/** Width of the hour-label gutter running down the left of the canvas. */
export const GUTTER_WIDTH = 54;

/**
 * A 15-minute block is only ~17px at PX_PER_MIN — too small to read or hit.
 * Blocks are floored at this height for rendering only; `top` still comes
 * from the true start time, so a floored block never pushes a later one down
 * (it can only visually overlap the gap after it, same tradeoff the web makes
 * in its own compact-render path).
 */
export const MIN_BLOCK_HEIGHT = 30;

/** Breathing room under the last hour rule so the final block isn't flush. */
export const CANVAS_BOTTOM_PADDING = 32;

export interface DayWindow {
  /** First hour rule drawn, 0-23. */
  startHour: number;
  /** Last hour rule drawn (exclusive upper bound), 1-24. */
  endHour: number;
}

/**
 * Always the full day — see this file's header for why a trimmed window
 * was tried and reverted. `blocks` is no longer read, but stays as a
 * parameter so every existing call site (which passes the day's blocks for
 * good reason — it's the natural thing to hand a "day window" function)
 * doesn't need to change, and so a future per-day override (e.g. "start an
 * unusually early day's window earlier") has an obvious place to read from.
 */
export function getDayWindow(_blocks: readonly ScheduleBlock[]): DayWindow {
  return { startHour: 0, endHour: 24 };
}

export function windowHeight(window: DayWindow): number {
  return (window.endHour - window.startHour) * HOUR_HEIGHT;
}

/** Y offset for an absolute minute-of-day inside the given window. */
export function minuteToY(minuteOfDay: number, window: DayWindow): number {
  return (minuteOfDay - window.startHour * 60) * PX_PER_MIN;
}

export function isWithinWindow(minuteOfDay: number, window: DayWindow): boolean {
  return minuteOfDay >= window.startHour * 60 && minuteOfDay <= window.endHour * 60;
}

export interface PositionedBlock {
  block: ScheduleBlock;
  startMin: number;
  endMin: number;
  /** Zero-based lane within an overlapping cluster. */
  column: number;
  /** How many lanes that cluster needs. */
  columnCount: number;
}

/**
 * Sort by start time and split concurrent blocks into side-by-side lanes.
 *
 * The web deliberately does NOT do this — draggable-block.tsx pins every block
 * to `left-1 right-1` and lets overlaps stack, which is workable with a mouse
 * (hover + drag reveals what's underneath) but on a phone a fully hidden block
 * is simply unreachable. Same clustering rule every calendar uses: a cluster
 * runs until a block starts at or after the cluster's running max end, and
 * within it each block takes the lowest lane that's already free.
 */
export function positionBlocks(blocks: readonly ScheduleBlock[]): PositionedBlock[] {
  const sorted = [...blocks]
    .map((block) => ({
      block,
      startMin: timeToMinutes(block.startTime),
      endMin: timeToMinutes(block.endTime),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const positioned: PositionedBlock[] = [];
  let cluster: PositionedBlock[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnCount = laneEnds.length;
    for (const entry of cluster) entry.columnCount = columnCount;
    positioned.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const entry of sorted) {
    if (entry.startMin >= clusterEnd) flush();

    let column = laneEnds.findIndex((end) => end <= entry.startMin);
    if (column === -1) {
      column = laneEnds.length;
      laneEnds.push(entry.endMin);
    } else {
      laneEnds[column] = entry.endMin;
    }

    cluster.push({ ...entry, column, columnCount: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  flush();

  return positioned;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Append an 8-bit alpha suffix to a category/goal hex color, mirroring the
 * web's `backgroundColor: ${accentColor}1a` in draggable-block.tsx. Returns
 * null for anything that isn't a 6-digit hex so a malformed stored color
 * degrades to a theme token instead of an invalid style value.
 */
export function withAlpha(color: string | undefined, alphaHex: string): string | null {
  if (!color || !HEX_COLOR.test(color)) return null;
  return `${color}${alphaHex}`;
}

export type BlockStatus = "past" | "active" | "upcoming";

export function blockStatus(
  entry: Pick<PositionedBlock, "startMin" | "endMin">,
  nowMinutes: number | null,
): BlockStatus {
  if (nowMinutes === null) return "upcoming";
  if (entry.endMin <= nowMinutes) return "past";
  if (entry.startMin <= nowMinutes) return "active";
  return "upcoming";
}

/**
 * Render density by available height. Direct port of the thresholds in
 * dw-time-web/.../draggable-block.tsx ("Below 20px we are in tiny mode:
 * title only... Below 44px we are compact"), scaled up for touch: mobile
 * type is larger and there's no hover affordance to recover hidden detail.
 */
export type BlockDensity = "tiny" | "compact" | "full";

export function blockDensity(height: number): BlockDensity {
  if (height < 40) return "tiny";
  if (height < 68) return "compact";
  return "full";
}

/** "9 AM" / "12 PM" — matches the web time-axis labels in schedule-grid.tsx. */
export function formatHourLabel(hour: number): string {
  const normalized = hour % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const display = normalized === 0 ? 12 : normalized > 12 ? normalized - 12 : normalized;
  return `${display} ${suffix}`;
}
