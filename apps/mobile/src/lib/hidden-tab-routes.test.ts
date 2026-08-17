// The guard that makes the back-destination table self-maintaining.
//
// The defect this exists to stop is not "message/[id] had the wrong
// destination" — it is that a hidden tab can be added with NO back handling
// and nothing anywhere complains. The screen looks finished, works under a
// finger on the in-app chevron, and only fails on Android hardware/gesture
// back, which is the one path a developer on a simulator never presses. Three
// screens shipped that way (note/[id], notification-settings, message/[id]).
//
// So the source of truth is _layout.tsx itself: this parses the `href: null`
// registrations out of it and holds both the table and the screens to that
// list. An ESLint rule cannot do this — ESLint sees one file at a time, and a
// rule running inside message/[id].tsx has no way to know that _layout.tsx
// registered that filename as a hidden tab. Any selector broad enough to fire
// there would also fire on the five real tabs, which must NOT have a handler.
// A source-scanning test can tell them apart, and this repo already uses that
// pattern (see note-row-actions.test.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HIDDEN_TAB_BACK_DESTINATIONS, hiddenTabBackDestination } from "./hidden-tab-routes";

const APP_DIR = join(__dirname, "..", "..", "app", "(app)");

/**
 * Routes that still name their destination locally instead of reading the
 * shared table. Every entry needs a reason and an expiry condition — this set
 * is meant to shrink to empty, never to become a parking space.
 *
 * Both entries below are the SAME situation, not a design choice: each file
 * was being rewritten by other work in flight at the time the table landed,
 * so converting the call site would have meant committing somebody else's
 * half-finished changes. Both already handle back correctly and both already
 * have their destination recorded in the table; only the call site is behind.
 *
 *   * `coach`: app/(app)/coach.tsx still reads
 *     `useHiddenTabBackHandler("/voice")`.
 *   * `note/[id]`: app/(app)/note/[id].tsx still hand-rolls the
 *     BackHandler subscription it wrote before the shared hook existed. It
 *     also flushes an unsaved draft first, which is why it was the last
 *     holdout — `useHiddenTabBackHandler`'s `onBeforeLeave` option exists
 *     precisely to absorb it when someone converts it.
 *
 * To close either one: change the call site to
 * `useHiddenTabBackHandler(hiddenTabBackDestination("<route>"))` and delete
 * it from this set. The assertions below then start enforcing it.
 */
const LITERAL_DESTINATION_EXCEPTIONS = new Set(["coach", "note/[id]"]);

/**
 * A hidden tab handles back if it uses the shared hook OR still hand-rolls
 * the same interception. Accepting both is deliberate: the defect this guard
 * exists to catch is a screen with NO back handling at all, which is a
 * different and far worse thing than a screen that handles it its own way.
 * Holding the hand-rolled screens to "must use the hook" would only mean
 * excluding them from this assertion too, which would stop it checking the
 * thing that actually matters for them.
 */
function handlesHardwareBack(source: string): boolean {
  return (
    source.includes("useHiddenTabBackHandler") ||
    /BackHandler\.addEventListener\(\s*["']hardwareBackPress["']/.test(source)
  );
}

function readAppFile(...segments: string[]): string {
  return readFileSync(join(APP_DIR, ...segments), "utf8");
}

/**
 * Every `<Tabs.Screen name="X" ...>` in the (app) layout whose options carry
 * `href: null`. Matched on the source text rather than by importing the
 * layout: importing it would pull in the whole navigator, every provider it
 * mounts and React Native itself, to answer a purely textual question.
 */
function hiddenTabNamesFromLayout(): string[] {
  const source = readAppFile("_layout.tsx");
  const names: string[] = [];

  // Non-greedy up to the self-closing `/>` so one screen's options can never
  // leak into the next and make a visible tab look hidden.
  for (const match of source.matchAll(/<Tabs\.Screen\b([\s\S]*?)\/>/g)) {
    const attributes = match[1];
    const name = /name=["']([^"']+)["']/.exec(attributes)?.[1];
    if (!name) continue;
    if (/href:\s*null/.test(attributes)) names.push(name);
  }

  return names;
}

describe("hidden tab back destinations", () => {
  const hiddenTabs = hiddenTabNamesFromLayout();

  // If this fails, the parser has drifted from the layout's formatting and
  // every other assertion here has quietly stopped checking anything. Pin it
  // so that failure is loud rather than an empty `it.each` that always passes.
  it("actually finds the hidden tabs in the layout", () => {
    expect(hiddenTabs.length).toBeGreaterThanOrEqual(15);
    expect(hiddenTabs).toContain("message/[id]");
    expect(hiddenTabs).toContain("notifications");
    // A real, visible tab must never show up here.
    expect(hiddenTabs).not.toContain("index");
  });

  it("covers exactly the hidden tabs the layout registers", () => {
    // Set equality in both directions: a newly added hidden tab with no
    // destination fails here, and so does an entry left behind after a route
    // is deleted.
    expect(Object.keys(HIDDEN_TAB_BACK_DESTINATIONS).sort()).toEqual([...hiddenTabs].sort());
  });

  it.each(hiddenTabs)("%s intercepts hardware back", (route) => {
    // The reported bug, and the only assertion here that would have caught it
    // before the fact: message/[id] had no interception at all, so Android
    // back fell through to the navigator's default and landed on Today.
    expect(handlesHardwareBack(readAppFile(`${route}.tsx`))).toBe(true);
  });

  it.each(hiddenTabs)("%s takes its destination from the shared table", (route) => {
    if (LITERAL_DESTINATION_EXCEPTIONS.has(route)) return;
    // Naming its own route is what keeps a screen and the table in agreement;
    // a bare Href literal at the call site is how they drift apart.
    expect(readAppFile(`${route}.tsx`)).toContain(`hiddenTabBackDestination("${route}")`);
  });

  it("keeps the exception list honest", () => {
    // An exception for a route that no longer exists means the list is stale.
    for (const route of LITERAL_DESTINATION_EXCEPTIONS) {
      expect(hiddenTabs).toContain(route);
    }
  });

  it("never sends a detail route back to the dashboard", () => {
    // The reported bug stated as a rule. A detail route (`foo/[id]`) is always
    // reached from a list, so Today is never the right answer for it.
    const detailRoutes = hiddenTabs.filter((name) => name.includes("/["));
    expect(detailRoutes.length).toBeGreaterThan(0);
    for (const route of detailRoutes) {
      expect(hiddenTabBackDestination(route as never)).not.toBe("/");
    }
  });

  it("sends the message thread back to the conversation list", () => {
    expect(hiddenTabBackDestination("message/[id]")).toBe("/messages");
  });

  it("gives every route an absolute path", () => {
    for (const destination of Object.values(HIDDEN_TAB_BACK_DESTINATIONS)) {
      expect(typeof destination).toBe("string");
      expect(destination.startsWith("/")).toBe(true);
    }
  });
});
