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
  const [y, m, d] = key.split("-").map(Number);
  return { year: y ?? 1970, month: (m ?? 1) - 1, day: d ?? 1 };
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
