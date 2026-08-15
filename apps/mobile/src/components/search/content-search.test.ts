// Cover for the "go anywhere" search's live-content matching — see this
// file's sibling (search-index.test.ts) for the static-index half.

import type { Goal, Note, Task } from "@goalslot/shared";

import { searchGoals, searchNotes, searchTasks } from "./content-search";

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "goal-1",
  title: "Learn Spanish",
  description: undefined,
  category: "Learning",
  targetHours: 100,
  loggedHours: 10,
  status: "ACTIVE",
  color: "#000000",
  ...overrides,
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  title: "Finish workbook chapter 3",
  status: "TODO",
  category: "Learning",
  goal: { id: "goal-1", title: "Learn Spanish", color: "#000000" },
  ...overrides,
});

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "note-1",
  title: "Spanish verb notes",
  content: "",
  icon: null,
  color: null,
  parentId: null,
  order: 0,
  isExpanded: true,
  isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
  ...overrides,
});

describe("searchGoals", () => {
  it("returns nothing for an empty query — content only shows while actively searching", () => {
    expect(searchGoals([goal()], "")).toEqual([]);
    expect(searchGoals([goal()], "   ")).toEqual([]);
  });

  it("finds a goal by title", () => {
    const results = searchGoals([goal()], "spanish");
    expect(results.map((r) => r.id)).toEqual(["goal-1"]);
    expect(results[0].kind).toBe("goal");
    expect(results[0].path).toBe("/goals?goalId=goal-1");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(searchGoals([goal()], "  SpAnIsH  ").map((r) => r.id)).toEqual(["goal-1"]);
  });

  it("finds a goal by category", () => {
    expect(searchGoals([goal()], "learning").map((r) => r.id)).toEqual(["goal-1"]);
  });

  it("returns nothing when no goal matches", () => {
    expect(searchGoals([goal()], "kayaking")).toEqual([]);
  });

  it("URL-encodes the id in the path", () => {
    const results = searchGoals([goal({ id: "goal/weird id" })], "spanish");
    expect(results[0].path).toBe("/goals?goalId=goal%2Fweird%20id");
  });
});

describe("searchTasks", () => {
  it("returns nothing for an empty query", () => {
    expect(searchTasks([task()], "")).toEqual([]);
  });

  it("finds a task by its own title", () => {
    const results = searchTasks([task()], "workbook");
    expect(results.map((r) => r.id)).toEqual(["task-1"]);
    expect(results[0].path).toBe("/tasks?taskId=task-1");
  });

  it("finds a task via its parent goal's title", () => {
    expect(searchTasks([task()], "spanish").map((r) => r.id)).toEqual(["task-1"]);
  });

  it("finds a task via its own category", () => {
    expect(searchTasks([task({ category: "chores", goal: undefined })], "chores").map((r) => r.id)).toEqual([
      "task-1",
    ]);
  });

  it("handles a task with no parent goal", () => {
    expect(searchTasks([task({ goal: undefined })], "workbook").map((r) => r.id)).toEqual(["task-1"]);
  });
});

describe("searchNotes", () => {
  it("returns nothing for an empty query", () => {
    expect(searchNotes([note()], "")).toEqual([]);
  });

  it("finds a note by title", () => {
    const results = searchNotes([note()], "verb");
    expect(results.map((r) => r.id)).toEqual(["note-1"]);
    expect(results[0].path).toBe("/note/note-1");
  });

  it("returns nothing when nothing matches", () => {
    expect(searchNotes([note()], "kayaking")).toEqual([]);
  });
});
