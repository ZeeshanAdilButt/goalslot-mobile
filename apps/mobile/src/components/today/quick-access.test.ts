// No import of `describe`/`it`/`expect` — Jest injects these as globals and
// this project has no @types/jest, so test files are excluded from
// `tsc --noEmit` (see tsconfig.json and the note atop deep-links.test.ts).
//
// WHAT THIS COVERS, AND WHAT IT DOESN'T. apps/mobile has no
// @testing-library/react-native — every test in this repo is pure `.ts`
// logic — so there is no render/tap coverage of QuickAccessRail here and
// this file does not pretend otherwise. Layout, tap-through and the rail's
// clearance from the floating button column in app/(app)/_layout.tsx are
// device checks, not unit checks.
//
// What it does cover is the one thing TypeScript genuinely cannot: the
// `href`s. They're written `"/notes" as Href`, and that cast defeats
// expo-router's typed-routes checking outright — `"/mentee" as Href` or
// `"/report" as Href` compiles clean and fails only at runtime, as a tap
// that goes nowhere. Checking each one against search-index.ts's route list
// (the app's own inventory of navigable screens, kept in step with
// DrawerContent) turns that into a test failure instead.

import { getSearchItems } from "../search/search-index";
import { QUICK_ACCESS_ITEMS } from "./quick-access";

describe("QUICK_ACCESS_ITEMS", () => {
  it("points every shortcut at a route the app actually has", () => {
    const knownHrefs = new Set<string>(getSearchItems().map((item) => item.href));
    for (const item of QUICK_ACCESS_ITEMS) {
      expect(knownHrefs.has(item.href as unknown as string)).toBe(true);
    }
  });

  it("includes the three destinations the rail exists for", () => {
    // Notes and Reports were only reachable from the bottom of Today's
    // scroll or the drawer; "Shared" (/mentees) had no Today entry at all.
    const byId = new Map(QUICK_ACCESS_ITEMS.map((item) => [item.id, item]));
    expect(byId.get("notes")?.href).toBe("/notes");
    expect(byId.get("reports")?.href).toBe("/reports");
    expect(byId.get("mentees")?.href).toBe("/mentees");
  });

  it("sends 'Shared' to the shared-with-me list, not to a per-person report", () => {
    // /mentee/[id] needs an ownerId and there is no aggregate view, so the
    // rail can only ever land on the list that supplies one.
    const shared = QUICK_ACCESS_ITEMS.find((item) => item.id === "mentees");
    expect(shared?.href).toBe("/mentees");
    expect(String(shared?.href).startsWith("/mentee/")).toBe(false);
  });

  it("stays a four-up row with unique keys", () => {
    // The rail divides the row width evenly; five items truncate the
    // captions and three leave a visibly loose row.
    expect(QUICK_ACCESS_ITEMS).toHaveLength(4);
    expect(new Set(QUICK_ACCESS_ITEMS.map((item) => item.id)).size).toBe(4);
    expect(new Set(QUICK_ACCESS_ITEMS.map((item) => item.href)).size).toBe(4);
  });

  it("gives every item a one-word caption and a fuller spoken label", () => {
    for (const item of QUICK_ACCESS_ITEMS) {
      // A quarter of a phone's width fits one short word, no more.
      expect(item.label.trim()).toBe(item.label);
      expect(item.label).not.toBe("");
      expect(item.label.split(" ")).toHaveLength(1);
      // The visible caption is too terse to stand alone for a screen reader.
      expect(item.accessibilityLabel.length).toBeGreaterThan(item.label.length);
    }
  });

  it("labels the sharing route the way the rest of the app does", () => {
    // _layout.tsx's Tabs.Screen title, DrawerContent and search-index all
    // call /mentees "Sharing" — the rail must not reintroduce "Mentees".
    const shared = QUICK_ACCESS_ITEMS.find((item) => item.id === "mentees");
    expect(shared?.label.toLowerCase()).not.toContain("mentee");
  });
});
