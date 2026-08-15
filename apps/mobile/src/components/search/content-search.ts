// Live-content half of the "go anywhere" search — see search-index.ts for
// the static screen index and its header for why content search (goals,
// tasks, notes by name) was deferred out of that first pass. This is that
// deferred piece.
//
// Matching mirrors search-index.ts / components/timer/tracking-search.ts:
// plain case/whitespace-insensitive substring matching, no fuzzy scoring.
// A goal also matches on its category, and a task additionally matches on
// its parent goal's title/category — same fields tracking-search.ts's
// filterGoals/filterTasks already search, so a name typed here finds the
// same things it would in the Time Tracker's picker.
//
// Each result carries a `path` — a full expo-router path string, already
// built with whatever query param or route segment that item's screen
// needs (see src/lib/deep-links.ts for the `?goalId=`/`?taskId=` convention
// and app/(app)/note/[id].tsx for the note route) — rather than a
// SearchHref, since content destinations aren't part of that fixed union.

import type { Goal, Note, Task } from "@goalslot/shared";

import type { IconName } from "@/components/ui/Icon";
import { normalizeSearchQuery } from "./search-index";

export type ContentKind = "goal" | "task" | "note";

export interface ContentSearchResult {
  id: string;
  kind: ContentKind;
  label: string;
  description: string;
  icon: IconName;
  path: string;
}

function matchesAny(fields: (string | null | undefined)[], needle: string): boolean {
  return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

/** Goals matching `query` by title or category. Empty query matches nothing — unlike the static index, content is only ever shown while actively searching. */
export function searchGoals(goals: Goal[], query: string): ContentSearchResult[] {
  const needle = normalizeSearchQuery(query);
  if (!needle) return [];
  return goals
    .filter((goal) => matchesAny([goal.title, goal.category], needle))
    .map((goal) => ({
      id: goal.id,
      kind: "goal" as const,
      label: goal.title,
      description: goal.category ? `Goal · ${goal.category}` : "Goal",
      icon: "goals" as IconName,
      path: `/goals?goalId=${encodeURIComponent(goal.id)}`,
    }));
}

/** Tasks matching `query` by title, category, or parent goal's title/category. */
export function searchTasks(tasks: Task[], query: string): ContentSearchResult[] {
  const needle = normalizeSearchQuery(query);
  if (!needle) return [];
  return tasks
    .filter((task) => matchesAny([task.title, task.category, task.goal?.title, task.goal?.category], needle))
    .map((task) => ({
      id: task.id,
      kind: "task" as const,
      label: task.title,
      description: task.goal?.title ? `Task · ${task.goal.title}` : "Task",
      icon: "tasks" as IconName,
      path: `/tasks?taskId=${encodeURIComponent(task.id)}`,
    }));
}

/** Notes matching `query` by title. */
export function searchNotes(notes: Note[], query: string): ContentSearchResult[] {
  const needle = normalizeSearchQuery(query);
  if (!needle) return [];
  return notes
    .filter((note) => matchesAny([note.title], needle))
    .map((note) => ({
      id: note.id,
      kind: "note" as const,
      label: note.title,
      description: "Note",
      icon: "notes" as IconName,
      path: `/note/${encodeURIComponent(note.id)}`,
    }));
}
