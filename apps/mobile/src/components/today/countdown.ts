// "When does the next thing start" — the label under the Today hero's
// "Up next".
//
// Port of dw-time-web's `describeUpcoming`
// (src/components/focus-now-bar.tsx:24-45), which is the reference for the
// exact phrasing ("starting now" / "in 25m" / "tomorrow" / "Fri").
//
// It lives in its own module rather than inside app/(app)/index.tsx so it
// can be unit tested: the same-day/tomorrow/later split has real edge cases
// (a block at 00:05 tomorrow is "tomorrow", not "in 20m"; a block six days
// out has to name its weekday rather than render four figures of minutes)
// and the Today screen has no component-level test harness to catch them.

import { DAYS_OF_WEEK, formatDuration } from "@goalslot/shared";

/**
 * Same calendar date in the runtime's local zone. Deliberately field-by-field
 * rather than a timestamp comparison — "is this the same day the user is
 * looking at" is a calendar question, not a duration one.
 */
export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Human countdown from `now` to `startsAt`.
 *
 * Only same-day starts get a duration. `findUpcomingScheduleBlocks` searches
 * up to seven days ahead, so a raw duration would render a free evening's
 * next block as "in 13h 20m" and next Friday's as a four-digit minute count
 * — technically true, useless to read.
 */
export function describeCountdown(now: Date, startsAt: Date): string {
  if (isSameCalendarDay(now, startsAt)) {
    const diffMin = Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
    return diffMin <= 0 ? "starting now" : `in ${formatDuration(diffMin)}`;
  }

  // Date#setDate normalises month/year rollover, so this is correct on the
  // 31st and on Dec 31 without a special case.
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameCalendarDay(tomorrow, startsAt)) return "tomorrow";

  return DAYS_OF_WEEK[startsAt.getDay()];
}
