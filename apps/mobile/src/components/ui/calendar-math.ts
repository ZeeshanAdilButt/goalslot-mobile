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
