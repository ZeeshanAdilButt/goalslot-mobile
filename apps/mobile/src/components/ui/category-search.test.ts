// Cover for CategoryAutocomplete's matching rule — see tracking-search.test.ts
// for the sibling convention this follows.

import { filterCategories, normalizeQuery } from "./category-search";

import type { Category } from "@goalslot/shared";

function category(id: string, name: string): Category {
  return {
    id,
    userId: "u1",
    name,
    value: name.toLowerCase(),
    color: "#000",
    isDefault: false,
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const categories = [category("c1", "Fitness"), category("c2", "Deep Work"), category("c3", "Personal")];

describe("filterCategories", () => {
  it("returns every category when the query is empty", () => {
    expect(filterCategories(categories, "")).toHaveLength(3);
    expect(filterCategories(categories, "   ")).toHaveLength(3);
  });

  it("finds a category by a substring of its name", () => {
    expect(filterCategories(categories, "fit").map((c) => c.id)).toEqual(["c1"]);
  });

  it("matches mid-word, not just a prefix", () => {
    expect(filterCategories(categories, "work").map((c) => c.id)).toEqual(["c2"]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(filterCategories(categories, "  PERSONAL  ").map((c) => c.id)).toEqual(["c3"]);
  });

  it("returns an empty list when nothing matches, rather than falling back to everything", () => {
    expect(filterCategories(categories, "kayaking")).toEqual([]);
  });

  it("tolerates an empty categories list", () => {
    expect(filterCategories([], "anything")).toEqual([]);
  });
});

describe("normalizeQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeQuery("  MiXeD Case  ")).toBe("mixed case");
  });
});
