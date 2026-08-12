// Search/filter logic for the Time Tracker's tracking picker.
//
// Extracted out of TrackingPicker.tsx so the matching rules can be unit
// tested the way this repo tests its other pure layers (see
// components/schedule/layout.ts and components/reports/aggregate.ts).
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: a goal search searches *every*
// goal the user has, always. Nothing else the user has selected — least of
// all a category — is allowed to narrow the candidate set first. On web this
// went wrong exactly once and was worth a bug report: a category had been
// pre-selected, the goal list was silently filtered down to that category,
// and typing a real goal's name returned "No matches" for a goal that plainly
// existed. The functions below therefore take a query and nothing else. There
// is deliberately no `category` parameter to pass, so a future caller cannot
// reintroduce that filter without changing this file and its tests.
//
// Category is still *searchable* — typing "health" finds the goals in that
// category — it just never acts as a hidden pre-filter. That is the whole
// distinction: category widens what a query can match, it never narrows what
// a query is allowed to see.

import type { Goal, Task } from "@goalslot/shared";

/** Trimmed + lowercased, the form both matchers compare against. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function matchesAny(fields: (string | null | undefined)[], needle: string): boolean {
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

/**
 * Goals matching `query`, searched across the goal's own title and its
 * category. An empty query returns the list untouched — "no search" means
 * "show everything", never "show nothing".
 */
export function filterGoals(goals: Goal[], query: string): Goal[] {
  const needle = normalizeQuery(query);
  if (!needle) return goals;
  return goals.filter((goal) => matchesAny([goal.title, goal.category], needle));
}

/**
 * Tasks matching `query`. A task is also findable by its parent goal's title
 * or category, since "the thing I'm about to track" is often remembered by
 * the goal it hangs off rather than by its own wording.
 */
export function filterTasks(tasks: Task[], query: string): Task[] {
  const needle = normalizeQuery(query);
  if (!needle) return tasks;
  return tasks.filter((task) =>
    matchesAny([task.title, task.category, task.goal?.title, task.goal?.category], needle),
  );
}
