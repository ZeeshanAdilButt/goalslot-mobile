// Column model for the mobile task board.
//
// The four columns, their order, and the helper line under each title are a
// direct port of dw-time-web/src/features/tasks/components/task-board.tsx:38-43
// (`BOARD_COLUMNS`). Titles are the web's exact strings ("To Do", not "TODO")
// rather than the LIST view's `taskStatusLabel(status)` — on a board the
// column head is a place, not a badge, so it reads as prose.
//
// Two deliberate differences from the web board:
//
//   1. Empty columns are KEPT. The list view drops them, mirroring web's
//      `groupTasksByStatus` (features/tasks/utils/utils.ts:6-19, which
//      `.filter`s out empty groups), but the board renders all four
//      unconditionally on web too — a column with nothing in it is still the
//      answer to "how much is in DOING right now?", and dropping it would
//      make the columns move around under the user's thumb as tasks change
//      status.
//   2. There is no `accent`/`text` Tailwind class pair here. Column colour
//      comes from the shared task-status tone map
//      (src/components/lists/tones.ts), which is itself the port of web's
//      task-status-styles.ts — one source of truth for "what colour is
//      DOING", shared with the list rows' left stripe.

import type { Task, TaskStatus } from "@goalslot/shared";

// Imported from the module rather than the `@/components/lists` barrel on
// purpose: the barrel re-exports CompleteCheckbox, which pulls in
// react-native-reanimated, which needs a native runtime and so can't be
// loaded by this repo's plain-Jest tests. This file is pure data + a sort,
// and board-columns.test.ts covers it — the deep import is what keeps that
// possible.
import { taskStatusTone, type Tone } from "@/components/lists/tones";

export interface BoardColumnDef {
  status: TaskStatus;
  /** Column head, e.g. "To Do" — web's `BOARD_COLUMNS[].title`. */
  title: string;
  /** One-line "what belongs here" — web's `BOARD_COLUMNS[].helper`. */
  helper: string;
  tone: Tone;
}

export const BOARD_COLUMNS: readonly BoardColumnDef[] = [
  { status: "BACKLOG", title: "Backlog", helper: "Capture ideas", tone: taskStatusTone("BACKLOG") },
  { status: "TODO", title: "To Do", helper: "Ready to start next", tone: taskStatusTone("TODO") },
  { status: "DOING", title: "Doing", helper: "In motion right now", tone: taskStatusTone("DOING") },
  { status: "DONE", title: "Done", helper: "Shipped and finished", tone: taskStatusTone("DONE") },
] as const;

export interface BoardColumnData extends BoardColumnDef {
  tasks: Task[];
}

/**
 * Buckets tasks into the four board columns.
 *
 * Within a column, order is `task.order` ascending — the same sort the web
 * board applies before it fills its columns (task-board.tsx:86). `Array#sort`
 * is stable, so tasks the API hasn't assigned an `order` to (all of them
 * default to 0 here) keep the order the list endpoint returned them in, which
 * is exactly what the list view shows. The two views therefore never disagree
 * about which of two tasks comes first.
 *
 * A task whose status isn't one of the four known values is dropped rather
 * than silently landing in Backlog — same as web, where `next[task.status]?.`
 * no-ops on an unknown key.
 */
export function buildBoardColumns(tasks: Task[]): BoardColumnData[] {
  const byStatus = new Map<TaskStatus, Task[]>(BOARD_COLUMNS.map((column) => [column.status, []]));

  for (const task of tasks) {
    byStatus.get(task.status)?.push(task);
  }

  return BOARD_COLUMNS.map((column) => ({
    ...column,
    tasks: (byStatus.get(column.status) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
}
