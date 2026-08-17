/**
 * Default start/end times for a quick-added schedule slot.
 *
 * Extracted out of `src/hooks/useQuickAdd.ts` so the arithmetic can be unit
 * tested directly — it produced the recurring "duplicate schedule blocks"
 * report and is exactly the kind of pure logic this codebase tests in
 * `src/lib/*.test.ts`.
 *
 * The bug: both helpers wrapped with `% (24 * 60)`. Quick-add anywhere in the
 * 60-minute window 22:30–23:29 therefore produced an INVERTED range —
 * `23:00–00:00` or `23:30–00:30`, where the end sorts before the start.
 *
 * That mattered because the API's `checkTimeConflict` compares raw minute
 * offsets with no midnight wrap-around, so an inverted block overlapped
 * nothing — not even a byte-identical copy of itself. Every repeat quick-add
 * in that window wrote another real row, and `23:00–00:00` renders as
 * "11:00 PM – 12:00 AM", which looks perfectly normal, so it was never
 * reported as a malformed block, only as a duplicated one.
 *
 * A second, quieter defect from the same wrap: at 23:30 or later the start
 * itself collapsed to `1440 % 1440 = 0`, silently placing the slot at
 * `00:00–01:00` — the wrong end of the same day.
 *
 * Both are fixed by clamping rather than wrapping, mirroring what
 * `ScheduleBlockSheet.tsx` already does with its own `LAST_MINUTE_OF_DAY`.
 * The server now rejects inverted ranges outright (goal-slot-api
 * `ScheduleService.assertValidRange`); this keeps the app from ever asking.
 */

/** 23:59 — a block may not run past the end of its own day. */
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/**
 * 23:30 — the latest a slot may START. Keeps the clamp on a clean half-hour
 * boundary (the same grid `defaultSlotStartTime` rounds to) while always
 * leaving room for a non-zero-length slot before `LAST_MINUTE_OF_DAY`.
 */
const LATEST_SLOT_START = 23 * 60 + 30;

const DEFAULT_SLOT_DURATION_MINUTES = 60;

function minutesToHHmm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * "The next half hour from now", clamped to `LATEST_SLOT_START` so it never
 * wraps into the following day.
 */
export function defaultSlotStartTime(now: Date = new Date()): string {
  const roundUpToHalfHour = now.getMinutes() < 30 ? 30 : 60;
  const totalMinutes = now.getHours() * 60 + roundUpToHalfHour;
  return minutesToHHmm(Math.min(totalMinutes, LATEST_SLOT_START));
}

/**
 * The default slot length after `startTime`, clamped to the end of the day.
 * Shortens the slot rather than letting it spill past midnight.
 */
export function defaultSlotEndTime(
  startTime: string,
  durationMinutes: number = DEFAULT_SLOT_DURATION_MINUTES,
): string {
  const start = timeToMinutes(startTime);
  return minutesToHHmm(Math.min(start + durationMinutes, LAST_MINUTE_OF_DAY));
}

/**
 * The pair the quick-add slot flow submits. Guaranteed to satisfy
 * `end > start` for every possible clock time.
 */
export function defaultSlotRange(now: Date = new Date()): {
  startTime: string;
  endTime: string;
} {
  const startTime = defaultSlotStartTime(now);
  return { startTime, endTime: defaultSlotEndTime(startTime) };
}
