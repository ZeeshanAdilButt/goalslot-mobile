// Cover for the tracking picker's matching rules.
//
// The case that matters most here is the negative one: searching a goal by
// name must find it no matter what category it belongs to, and no matter what
// else is selected. That is the exact failure this module was split out to
// prevent (a pre-selected category silently filtering the goal list, so a real
// goal's name returned "No matches"), and it is the kind of regression that
// reads as a data problem rather than a filter problem when it happens.

import { filterGoals, filterTasks, normalizeQuery } from "./tracking-search";

import type { Goal, Task } from "@goalslot/shared";

function goal(id: string, title: string, category: string): Goal {
  return { id, title, category, color: "#000", status: "ACTIVE", targetHours: 1, loggedHours: 0 } as Goal;
}

function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return { id, title, status: "TODO", ...extra } as Task;
}

const goals = [
  goal("g1", "Ship the mobile app", "work"),
  goal("g2", "Run a half marathon", "health"),
  goal("g3", "Read 12 books", "personal"),
];

describe("filterGoals", () => {
  it("returns every goal when the query is empty", () => {
    expect(filterGoals(goals, "")).toHaveLength(3);
    expect(filterGoals(goals, "   ")).toHaveLength(3);
  });

  it("finds a goal by title regardless of which category it sits in", () => {
    // The web bug in one assertion: "marathon" is a health goal, and it must
    // still be findable when the user's mind (or a form) is on "work".
    expect(filterGoals(goals, "marathon").map((g) => g.id)).toEqual(["g2"]);
  });

  it("matches on category as well as title, so a category widens the search", () => {
    expect(filterGoals(goals, "health").map((g) => g.id)).toEqual(["g2"]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(filterGoals(goals, "  SHIP  ").map((g) => g.id)).toEqual(["g1"]);
  });

  it("returns an empty list only when nothing genuinely matches", () => {
    expect(filterGoals(goals, "kayaking")).toEqual([]);
  });

  it("takes no filter beyond the query — the signature cannot express one", () => {
    // Guards the property the module exists for: every goal is a candidate on
    // every search. If someone later threads a category in, this breaks.
    expect(filterGoals.length).toBe(2);
  });
});

describe("filterTasks", () => {
  const tasks = [
    task("t1", "Write release notes", { category: "work" }),
    task("t2", "Long run", { goal: { id: "g2", title: "Run a half marathon", color: "#0f0", category: "health" } }),
    task("t3", "Buy shoes"),
  ];

  it("returns every task when the query is empty", () => {
    expect(filterTasks(tasks, "")).toHaveLength(3);
  });

  it("finds a task by its own title", () => {
    expect(filterTasks(tasks, "release").map((t) => t.id)).toEqual(["t1"]);
  });

  it("finds a task by its parent goal's title", () => {
    expect(filterTasks(tasks, "half marathon").map((t) => t.id)).toEqual(["t2"]);
  });

  it("finds a task by its parent goal's category", () => {
    expect(filterTasks(tasks, "health").map((t) => t.id)).toEqual(["t2"]);
  });

  it("tolerates tasks with no category and no goal", () => {
    expect(() => filterTasks(tasks, "shoes")).not.toThrow();
    expect(filterTasks(tasks, "shoes").map((t) => t.id)).toEqual(["t3"]);
  });
});

describe("normalizeQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeQuery("  MiXeD Case  ")).toBe("mixed case");
  });
});
