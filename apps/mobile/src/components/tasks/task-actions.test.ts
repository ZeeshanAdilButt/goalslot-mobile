// Confirmation copy and the completion-direction split are the two pieces of
// the task row worth pinning down: everything else there is layout. Matches
// the repo's existing pure-logic test style (board-columns.test.ts,
// src/components/timer/session-entries.test.ts) — no renderer, no React.

import type { Task } from "@goalslot/shared";

import { describeTaskDelete, taskCompletionAction } from "./task-actions";

function task(overrides: Partial<Task> = {}): Task {
  return { id: "t1", title: "Ship the board", status: "TODO", ...overrides };
}

describe("describeTaskDelete", () => {
  it("names the task and says the delete is permanent", () => {
    const copy = describeTaskDelete(task());

    expect(copy.title).toBe("Delete this task?");
    expect(copy.description).toContain('"Ship the board"');
    expect(copy.description).toContain("permanently removed");
    expect(copy.description).toContain("can't be undone");
  });

  it("names the goal a task is filed under, when it has one", () => {
    const copy = describeTaskDelete(task({ goal: { id: "g1", title: "Olostep", color: "#F2CC0D" } }));

    expect(copy.description).toContain('from "Olostep"');
  });

  it("omits the goal clause entirely for a task with no goal", () => {
    expect(describeTaskDelete(task()).description).not.toContain(" from ");
  });

  // The point of the DONE branch: Restore now sits right next to Delete on a
  // done row, and `POST /tasks/:id/restore` only un-completes — it cannot
  // resurrect a hard-deleted task. The copy has to say so.
  it("tells a DONE task's owner that Restore will not bring it back", () => {
    const copy = describeTaskDelete(task({ status: "DONE" }));

    expect(copy.description).toContain("Restore only un-completes");
    expect(copy.description).toContain("can't bring a deleted one back");
  });
});

describe("taskCompletionAction", () => {
  it.each<Task["status"]>(["BACKLOG", "TODO", "DOING"])("completes a %s task", (status) => {
    const action = taskCompletionAction(task({ status }));

    expect(action.kind).toBe("complete");
    expect(action.label).toBe("Complete");
    expect(action.icon).toBe("check");
    expect(action.accessibilityLabel).toBe('Complete "Ship the board"');
  });

  it("restores a DONE task instead", () => {
    const action = taskCompletionAction(task({ status: "DONE" }));

    expect(action.kind).toBe("restore");
    expect(action.label).toBe("Restore");
    expect(action.icon).toBe("refresh");
    expect(action.accessibilityLabel).toBe('Mark "Ship the board" as not done');
    expect(action.accessibilityHint).toContain("To Do");
  });

  // The hint has to match what tasks.tsx's `handleComplete` actually posts:
  // `actualMinutes: task.estimatedMinutes ?? 1`.
  it("announces the estimate that completing will log", () => {
    expect(taskCompletionAction(task({ estimatedMinutes: 90 })).accessibilityHint).toBe(
      "Marks it done and logs 1h 30m against it",
    );
  });

  it("falls back to the one-minute floor when there is no estimate", () => {
    expect(taskCompletionAction(task()).accessibilityHint).toBe("Marks it done and logs one minute against it");
  });

  // 0 isn't reachable through this app's own writes (createTaskSchema puts a
  // min of 1 on `estimatedMinutes`), but a stale or hand-edited record
  // shouldn't make a screen reader announce "logs 0m".
  it("treats a zero estimate as no estimate", () => {
    expect(taskCompletionAction(task({ estimatedMinutes: 0 })).accessibilityHint).toContain("one minute");
  });
});
