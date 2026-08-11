// Reading and phrasing a goal's deadline.
//
// WHY this module exists: `Goal.deadline` is typed `string` (packages/shared/
// src/types/goal.ts) but the API stores it as a Prisma `DateTime?`
// (dw-time-api/prisma/schema.prisma:99) built with `new Date(dto.deadline)`
// (dw-time-api/src/modules/goals/goals.service.ts:149), so what actually
// comes back over the wire is a full ISO-8601 instant —
// "2026-03-04T00:00:00.000Z" — NOT the "YYYY-MM-DD" calendar key the rest of
// this app passes around (`getLocalDateString`, DatePicker, journal entries,
// task due dates).
//
// dw-time-web normalises that at the form boundary and nowhere else:
//   src/features/goals/components/goal-modal.tsx:118 —
//   `deadline: goal.deadline ? goal.deadline.split('T')[0] : ''`
// Both mobile call sites were missing that step, in opposite directions:
//   - EditGoalSheet fed the raw ISO string to a "YYYY-MM-DD" parser, which
//     produced NaN parts and rendered the literal text "Invalid Date".
//   - goals.tsx fed it to `new Date(...)`, which reads the UTC instant in
//     local time and therefore shows the PREVIOUS day for every user behind
//     UTC — exactly the trap `getLocalDateString`
//     (packages/shared/src/scheduling/time.ts:44-53) warns not to
//     reintroduce.
// Slicing the calendar day off the front and formatting from its parts is
// correct for both, because the instant the server holds was itself built
// from a bare calendar date (UTC midnight) — the day is in the first ten
// characters and nowhere else.
//
// Kept free of any react-native / Icon import on purpose, same reason
// src/components/ui/calendar-math.ts is: jest can then exercise it without
// dragging in lucide-react-native's untransformed ESM build.

import { daysInMonth, parseDateKey } from "@/components/ui/calendar-math";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A deadline within this many days reads as urgent. */
const SOON_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export type DeadlineUrgency = "overdue" | "today" | "soon" | "later";

/**
 * Normalises whatever the API hands back — a full ISO instant, or a bare
 * calendar day if that ever changes — into the app's canonical
 * "YYYY-MM-DD" key. Returns null for missing or unparseable values so a
 * malformed record degrades to "no deadline" instead of rendering
 * "Invalid Date".
 */
export function toDeadlineKey(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const key = deadline.trim().slice(0, 10);
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month - 1)) return null;

  return key;
}

/** Local midnight for a date key — never `new Date(key)`, see the header. */
function toLocalDate(key: string): Date {
  const { year, month, day } = parseDateKey(key);
  return new Date(year, month, day);
}

/** Whole days from `fromKey` to `toKey`. Rounds, so a DST day still counts as one. */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((toLocalDate(toKey).getTime() - toLocalDate(fromKey).getTime()) / MS_PER_DAY);
}

/** Long form for the edit sheet — the same `MMM d, yyyy` shape web uses. */
export function formatDeadlineLong(key: string): string {
  return toLocalDate(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Short form for the row chip. The year is dropped when it's the current one
 * (a phone chip has no room for it) but KEPT otherwise — "Due Mar 4" for a
 * 2028 deadline is worse than a slightly wider chip.
 */
export function formatDeadlineDay(key: string, todayKey: string): string {
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  return toLocalDate(key).toLocaleDateString(
    undefined,
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );
}

/**
 * Date keys are fixed-width and zero-padded, so lexicographic order IS
 * chronological order — no Date construction needed for the comparison.
 */
export function deadlineUrgency(key: string, todayKey: string): DeadlineUrgency {
  if (key < todayKey) return "overdue";
  if (key === todayKey) return "today";
  return daysBetween(todayKey, key) <= SOON_DAYS ? "soon" : "later";
}

/**
 * The chip's text. The web card prints a flat "Deadline · Mar 4, 2026" in
 * muted grey (goal-item.tsx:148) because it sits under a progress bar with
 * plenty of surrounding context. On a phone the chip row is the only place
 * this metadata lives, so it says what the date MEANS rather than only what
 * it is — and, paired with `deadlineUrgency`, stops every goal from wearing
 * the same permanently-amber "warning" chip the previous version hardcoded.
 */
export function describeDeadline(key: string, todayKey: string): string {
  const urgency = deadlineUrgency(key, todayKey);
  if (urgency === "today") return "Due today";
  if (urgency === "overdue") return `Overdue · ${formatDeadlineDay(key, todayKey)}`;
  if (daysBetween(todayKey, key) === 1) return "Due tomorrow";
  return `Due ${formatDeadlineDay(key, todayKey)}`;
}
