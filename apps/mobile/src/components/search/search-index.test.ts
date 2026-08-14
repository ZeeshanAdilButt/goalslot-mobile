// Cover for the "go anywhere" search's matching rules — see this file's
// sibling for why Settings' sub-sections are modelled as keywords on one
// item rather than separate routes, and why matching is plain substring
// rather than fuzzy (mirrors components/timer/tracking-search.ts).

import { filterSearchItems, getSearchItems, normalizeSearchQuery } from "./search-index";

describe("filterSearchItems", () => {
  const items = getSearchItems();

  it("returns every item when the query is empty", () => {
    expect(filterSearchItems(items, "")).toEqual(items);
    expect(filterSearchItems(items, "   ")).toEqual(items);
  });

  it("finds a screen by its own label", () => {
    expect(filterSearchItems(items, "reports").map((i) => i.id)).toEqual(["reports"]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(filterSearchItems(items, "  RePoRtS  ").map((i) => i.id)).toEqual(["reports"]);
  });

  it("finds Coach AI via the 'ai coach' keyword, matching the user's own phrasing", () => {
    expect(filterSearchItems(items, "ai coach").map((i) => i.id)).toEqual(["coach"]);
  });

  it("finds Settings via a sub-section keyword that never appears in the word 'Settings'", () => {
    expect(filterSearchItems(items, "password").map((i) => i.id)).toEqual(["settings"]);
    expect(filterSearchItems(items, "delete account").map((i) => i.id)).toEqual(["settings"]);
  });

  it("matches on description text too", () => {
    expect(filterSearchItems(items, "stats and trends").map((i) => i.id)).toEqual(["reports"]);
  });

  it("returns an empty list when nothing genuinely matches", () => {
    expect(filterSearchItems(items, "kayaking")).toEqual([]);
  });

  it("takes no filter beyond the query — the signature cannot express one", () => {
    expect(filterSearchItems.length).toBe(2);
  });
});

describe("getSearchItems", () => {
  it("has no duplicate ids or hrefs", () => {
    const items = getSearchItems();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });
});

describe("normalizeSearchQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeSearchQuery("  MiXeD Case  ")).toBe("mixed case");
  });
});
