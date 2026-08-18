// "Due today" logic for the Today screen's "Due today" Section and the
// "Tasks done" stat's denominator (app/(app)/index.tsx).
//
// This used to also count every undated TODO/DOING task as "due today" — a
// deliberate fallback for tasks with "no better home on a daily agenda than
// today". Users reported that as wrong: a task with no due date is not due
// today, and the fallback made both the "Due today" list and the "Tasks
// done X/Y" stat lie about what's actually due. This now strictly requires
// an actual `dueDate` that matches today's local date. DONE tasks never
// count, regardless of due date.

import type { Task } from "@goalslot/shared";

export function isDueToday(task: Task, todayStr: string): boolean {
  if (task.status === "DONE") return false;
  return task.dueDate?.slice(0, 10) === todayStr;
}

export function sortByStatusThenTitle(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === "DOING" ? -1 : b.status === "DOING" ? 1 : 0;
  return a.title.localeCompare(b.title);
}
