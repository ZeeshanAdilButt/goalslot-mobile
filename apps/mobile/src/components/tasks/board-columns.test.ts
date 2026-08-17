// Grouping is the one piece of the board with behaviour worth pinning down:
// everything else is layout. Matches the repo's existing pure-logic test
// style (src/lib/deep-links.test.ts, src/components/schedule/layout.test.ts) —
// no renderer, no React.

import type { Task } from "@goalslot/shared";

import { BOARD_COLUMNS, buildBoardColumns, TASK_STATUS_OPTIONS } from "./board-columns";

function task(id: string, status: Task["status"], order?: number): Task {
  return { id, title: id, status, ...(order === undefined ? {} : { order }) };
}

describe("buildBoardColumns", () => {
  it("renders all four columns in web's order, even when empty", () => {
    const columns = buildBoardColumns([]);

    expect(columns.map((column) => column.status)).toEqual(["BACKLOG", "TODO", "DOING", "DONE"]);
    expect(columns.every((column) => column.tasks.length === 0)).toBe(true);
  });

  it("buckets each task into its own status column", () => {
    const columns = buildBoardColumns([
      task("a", "DONE"),
      task("b", "BACKLOG"),
      task("c", "DOING"),
      task("d", "BACKLOG"),
    ]);

    const byStatus = Object.fromEntries(columns.map((column) => [column.status, column.tasks.map((t) => t.id)]));
    expect(byStatus).toEqual({ BACKLOG: ["b", "d"], TODO: [], DOING: ["c"], DONE: ["a"] });
  });

  it("sorts a column by `order` ascending", () => {
    const columns = buildBoardColumns([task("third", "TODO", 3), task("first", "TODO", 1), task("second", "TODO", 2)]);

    expect(columns[1].tasks.map((t) => t.id)).toEqual(["first", "second", "third"]);
  });

  it("keeps API order for tasks with no `order` (stable sort)", () => {
    const columns = buildBoardColumns([task("x", "TODO"), task("y", "TODO"), task("z", "TODO")]);

    expect(columns[1].tasks.map((t) => t.id)).toEqual(["x", "y", "z"]);
  });

  it("does not mutate the caller's array", () => {
    const tasks = [task("b", "TODO", 2), task("a", "TODO", 1)];
    buildBoardColumns(tasks);

    expect(tasks.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("carries a tone and a helper line for every column", () => {
    expect(BOARD_COLUMNS.every((column) => !!column.tone && !!column.helper && !!column.title)).toBe(true);
  });
});

describe("TASK_STATUS_OPTIONS", () => {
  it("mirrors BOARD_COLUMNS' statuses, order, and labels", () => {
    expect(TASK_STATUS_OPTIONS).toEqual(
      BOARD_COLUMNS.map((column) => ({ value: column.status, label: column.title })),
    );
  });

  it("covers all four statuses exactly once", () => {
    expect(TASK_STATUS_OPTIONS.map((option) => option.value)).toEqual(["BACKLOG", "TODO", "DOING", "DONE"]);
  });
});
