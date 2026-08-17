// Pure calendar math for DatePicker, kept out of the component file
// deliberately: DatePicker.tsx imports Icon.tsx, which imports
// lucide-react-native's ESM build, which jest's config doesn't transform —
// pulling that in just to test this arithmetic crashes the whole suite on
// an unrelated import chain. Isolating it here means this logic (and its
// tests) never touch that chain at all.

/** "YYYY-MM-DD" — the same string `getLocalDateString` (packages/shared/src/
 *  scheduling/time.ts) already produces everywhere else a local calendar day
 *  is stored (journal entries, goal deadlines, task due dates). */
export function parseDateKey(key: string): { year: number; month: number; day: number } {
  // `?? 1` was the original guard here and it does not hold: `??` only catches
  // null/undefined, so a non-numeric segment (`Number("20T00:00:00.000Z")`)
  // passes straight through as NaN, `new Date(y, m, NaN)` is an Invalid Date,
  // and `toLocaleDateString` then renders the literal text "Invalid Date" to
  // the user. `Number.isFinite` is the check that actually covers it.
  // Callers holding a value that might not be a bare key should normalise it
  // with `toDateKeyFromApi` first rather than rely on these fallbacks.
  const [y, m, d] = key.split("-").map(Number);
  return {
    year: Number.isFinite(y) ? y : 1970,
    month: (Number.isFinite(m) ? m : 1) - 1,
    day: Number.isFinite(d) ? d : 1,
  };
}

/** "YYYY-MM-DD" -> "Aug 30". Goes through `parseDateKey` + a local
 *  `Date(y, m, d)` rather than `new Date(dateString)` directly — the latter
 *  parses "YYYY-MM-DD" as UTC midnight, which `toLocaleDateString` can then
 *  render as the previous day in negative-UTC-offset timezones. */
export function formatDateKey(key: string): string {
  const { year, month, day } = parseDateKey(key);
  return new Date(year, month, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function toDateKey(year: number, month: number, day: number): string {
  const mm = (month + 1).toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Normalises whatever the API hands back for a calendar-day field into the
 * app's canonical "YYYY-MM-DD" key.
 *
 * WHY this is needed at all: every calendar-day column in the API is a Prisma
 * `DateTime?` built with `new Date(dto.x)`, and nothing reshapes it on the way
 * out (no serializer interceptor), so what actually arrives over the wire is a
 * full ISO-8601 instant — "2026-08-20T00:00:00.000Z" — even though the shared
 * types call it a `string`. Feeding that to `parseDateKey`/`formatDateKey`
 * yields NaN parts and prints "Invalid Date". Slicing the calendar day off the
 * front is correct because the instant the server holds was itself built from
 * a bare calendar date (UTC midnight): the day is in the first ten characters
 * and nowhere else.
 *
 * Returns null for missing or unparseable values, so a malformed record
 * degrades to "no date" instead of rendering a broken chip.
 *
 * Lives here rather than in a feature folder because both `goals/deadline.ts`
 * (Goal.deadline) and `tasks/due-date.ts` (Task.dueDate) need the identical
 * guard — Goals got it first, Tasks shipped without it and regressed.
 */
export function toDateKeyFromApi(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().slice(0, 10);
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month - 1)) return null;

  return key;
}
