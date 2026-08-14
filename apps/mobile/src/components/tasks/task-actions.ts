// Pure copy + decision logic for a task row's destructive and completion
// actions, shared by the list view (app/(app)/tasks.tsx) and the board card
// (TaskBoardCard.tsx) so the two never word the same action differently.
//
// Split out of the components for the same reason board-columns.ts and
// components/timer/session-entries.ts were: this repo unit-tests its extracted
// pure layers rather than rendering screens, and confirmation copy for an
// unrecoverable delete is exactly the kind of thing you want a regression test
// on. Everything below is a plain function of its arguments.
//
// Only `import type` from anything React-ish, deliberately — the same
// constraint board-columns.ts documents. A value import from @/components/ui
// or @/components/lists drags in lucide/reanimated, which need a native
// runtime and can't be loaded by this repo's plain-Jest tests.

import { formatDuration, type Task } from "@goalslot/shared";

import type { IconName } from "@/components/ui/Icon";

/**
 * Copy for the delete confirmation.
 *
 * `DELETE /tasks/:id` is a HARD delete server-side, and `POST
 * /tasks/:id/restore` — despite the name — only un-completes a completed task
 * (see tasks.tsx's `handleMoveToStatus` header). Now that Restore sits right
 * next to Delete on a DONE row, "restore will get it back" is a plausible and
 * completely wrong mental model, so the DONE branch says outright that it
 * won't. That distinction is why this reads as more than boilerplate "are you
 * sure?" text.
 *
 * The goal is named when the task has one because that's the context the row's
 * own chip carries and the thing a user is deciding about ("am I dropping this
 * from Olostep?"), not just an anonymous line item.
 */
export function describeTaskDelete(task: Task): { title: string; description: string } {
  const scope = task.goal?.title ? ` from "${task.goal.title}"` : "";
  return {
    title: "Delete this task?",
    description:
      task.status === "DONE"
        ? `"${task.title}" will be permanently removed${scope}. Restore only un-completes a task — it can't bring a deleted one back.`
        : `"${task.title}" will be permanently removed${scope}. This can't be undone.`,
  };
}

/**
 * The completion control on a task, in whichever of its two directions the
 * task's current status calls for.
 *
 * A DONE task used to have no way back from the list view at all: the checkbox
 * was `disabled`, the complete-swipe rendered nothing, and the only route was
 * switching to Board and using the Move sheet. Both directions are real
 * operations on the API (`POST /complete` and `POST /restore`), so both get a
 * control — and modelling them as one "flip this task's done-ness" action is
 * what keeps the checkbox honest: `accessibilityRole="checkbox"` promises a
 * two-way toggle, so a checkbox that can only ever be ticked is a lie to a
 * screen reader.
 */
export interface TaskCompletionAction {
  /** Which direction the tap/swipe goes. Callers route this to complete vs restore. */
  kind: "complete" | "restore";
  /** Caption on the swipe panel. */
  label: string;
  icon: IconName;
  /** Screen-reader label — used by both the checkbox and the swipe action. */
  accessibilityLabel: string;
  /**
   * Spells out the side effect neither control can show. Completing WRITES a
   * time entry (tasks.tsx's `handleComplete` defaults `actualMinutes` to the
   * task's own estimate, falling back to the schema minimum of 1); restoring
   * DELETES that entry and recomputes the goal's logged hours.
   */
  accessibilityHint: string;
}

export function taskCompletionAction(task: Task): TaskCompletionAction {
  if (task.status === "DONE") {
    return {
      kind: "restore",
      label: "Restore",
      icon: "refresh",
      accessibilityLabel: `Mark "${task.title}" as not done`,
      accessibilityHint: "Moves it back to To Do and removes the time entry completing it logged",
    };
  }

  return {
    kind: "complete",
    label: "Complete",
    icon: "check",
    accessibilityLabel: `Complete "${task.title}"`,
    accessibilityHint: task.estimatedMinutes
      ? `Marks it done and logs ${formatDuration(task.estimatedMinutes)} against it`
      : "Marks it done and logs one minute against it",
  };
}
