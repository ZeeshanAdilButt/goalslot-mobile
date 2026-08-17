// Reading and phrasing a task's due date.
//
// WHY this module exists: `Task.dueDate` is typed `string` (packages/shared/
// src/types/task.ts) but the API stores it as a Prisma `DateTime?`
// (goal-slot-api/prisma/schema.prisma:308) built with `new Date(dto.dueDate)`
// (goal-slot-api/src/modules/tasks/tasks.service.ts:34), and no serializer
// reshapes it on the way out — so what actually arrives over the wire is a
// full ISO-8601 instant, "2026-08-20T00:00:00.000Z", NOT the "YYYY-MM-DD"
// calendar key the rest of this app passes around.
//
// TaskMetaChips fed that raw instant straight to `formatDateKey`, whose
// `split("-")` produced ["2026","08","20T00:00:00.000Z"] -> NaN day -> an
// Invalid Date -> the literal text "Invalid Date" in the chip. The chip row
// uppercases its labels (typography.caption), which is why it read
// "DUE INVALID DATE" on screen.
//
// This is the exact bug goals/deadline.ts was written to fix for
// `Goal.deadline` — see its header, which even lists "task due dates" among
// the consumers of the date-key convention. Tasks never got the same guard.
// The normaliser is now shared: `toDateKeyFromApi` in ui/calendar-math.ts.
//
// Two properties matter here beyond "stop printing Invalid Date":
//   - The value is normalised, not merely validated, so ANY task with a due
//     date — Coach-created or not — renders correctly on the next refetch.
//     No data migration is involved; the stored rows were always valid.
//   - Anything unparseable returns null so the caller can drop the chip
//     entirely. A broken row degrades to "no due date" rather than to a chip
//     that looks like a rendering failure.
//
// Kept free of any react-native import on purpose, same reason
// ui/calendar-math.ts and goals/deadline.ts are: jest can then exercise it
// without dragging in lucide-react-native's untransformed ESM build. That is
// also why this isn't just a helper inside TaskMetaChips.tsx, which does
// import react-native.

import { formatDateKey, toDateKeyFromApi } from "@/components/ui/calendar-math";

/**
 * The task's due date as the app's canonical "YYYY-MM-DD" key, or null when
 * there isn't one (or the stored value can't be read as a calendar day).
 */
export function toDueDateKey(dueDate: string | null | undefined): string | null {
  return toDateKeyFromApi(dueDate);
}

/**
 * Due dates as "Mar 4" — web renders `formatDate(task.dueDate, 'MMM d')`.
 * Returns null rather than a placeholder string: the caller renders no chip
 * at all, which is the correct representation of "this task has no readable
 * due date".
 */
export function formatDueDate(dueDate: string | null | undefined): string | null {
  const key = toDueDateKey(dueDate);
  return key ? formatDateKey(key) : null;
}
