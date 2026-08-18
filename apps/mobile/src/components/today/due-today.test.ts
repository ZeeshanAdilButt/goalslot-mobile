// No import of `describe`/`it`/`expect` — Jest injects these as globals and
// this project has no @types/jest, so test files are excluded from
// `tsc --noEmit` (see quick-access.test.ts for the same note).

import type { Task, TaskStatus } from "@goalslot/shared";

import { isDueToday, sortByStatusThenTitle } from "./due-today";

const TODAY = "2026-08-18";
const OTHER_DAY = "2026-08-19";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Untitled",
    status: "TODO",
    ...overrides,
  };
}

describe("isDueToday", () => {
  it("is true for a task explicitly due today", () => {
    expect(isDueToday(makeTask({ dueDate: `${TODAY}T00:00:00.000Z` }), TODAY)).toBe(true);
  });

  it("is false for a task due a different day", () => {
    expect(isDueToday(makeTask({ dueDate: `${OTHER_DAY}T00:00:00.000Z` }), TODAY)).toBe(false);
  });

  // The regression this whole module exists for: an undated task used to
  // fall back to "due today" whenever it was TODO/DOING. That fallback is
  // gone — a task with no due date is never due today, regardless of status.
  it.each<TaskStatus>(["BACKLOG", "TODO", "DOING"])(
    "is false for an undated %s task (no more undated fallback)",
    (status) => {
      expect(isDueToday(makeTask({ status, dueDate: undefined }), TODAY)).toBe(false);
    },
  );

  it("is false for a DONE task even if its due date is today", () => {
    expect(isDueToday(makeTask({ status: "DONE", dueDate: `${TODAY}T00:00:00.000Z` }), TODAY)).toBe(false);
  });

  it("is false for a DONE task with no due date", () => {
    expect(isDueToday(makeTask({ status: "DONE", dueDate: undefined }), TODAY)).toBe(false);
  });

  it("matches on the calendar day only, ignoring the time-of-day component", () => {
    expect(isDueToday(makeTask({ dueDate: `${TODAY}T23:59:59.999Z` }), TODAY)).toBe(true);
  });
});

describe("sortByStatusThenTitle", () => {
  it("sorts DOING tasks ahead of other statuses", () => {
    const doing = makeTask({ id: "a", status: "DOING", title: "Zebra" });
    const todo = makeTask({ id: "b", status: "TODO", title: "Apple" });
    expect(sortByStatusThenTitle(doing, todo)).toBeLessThan(0);
    expect(sortByStatusThenTitle(todo, doing)).toBeGreaterThan(0);
  });

  it("sorts alphabetically by title within the same status", () => {
    const a = makeTask({ id: "a", status: "TODO", title: "Apple" });
    const b = makeTask({ id: "b", status: "TODO", title: "Banana" });
    expect(sortByStatusThenTitle(a, b)).toBeLessThan(0);
    expect(sortByStatusThenTitle(b, a)).toBeGreaterThan(0);
  });

  it("treats any two non-DOING statuses as equal-priority, regardless of title", () => {
    const backlog = makeTask({ id: "a", status: "BACKLOG", title: "Apple" });
    const todo = makeTask({ id: "b", status: "TODO", title: "Banana" });
    expect(sortByStatusThenTitle(backlog, todo)).toBe(0);
  });
});
