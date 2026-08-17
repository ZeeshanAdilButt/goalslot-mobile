// Where Android hardware/gesture back lands from each hidden tab.
//
// Every screen registered with `href: null` in app/(app)/_layout.tsx is a
// hidden Tabs.Screen: it keeps the group's auth guard without restructuring
// the navigator into a root stack, but it is NOT a stack entry. There is no
// back stack to pop, so an unhandled back press falls through to the Tabs
// navigator, whose react-navigation default `backBehavior` is `firstRoute` —
// the Today dashboard. That is not a fallback anyone chose; it is what
// happens when nothing is wired up, and it has now been reported as a bug
// three separate times (note/[id], notification-settings, and message/[id],
// which is what prompted this table).
//
// The destination therefore has to be stated explicitly for every hidden
// tab, and it lives HERE rather than as a literal at each call site for two
// reasons:
//
//   1. A reviewer can read the whole navigation contract in one place and
//      see that `message/[id]` returns to Messages rather than Today. Spread
//      across fifteen files, nobody ever compared them — which is precisely
//      how the reported bug survived.
//   2. hidden-tab-routes.test.ts parses the `href: null` registrations
//      straight out of _layout.tsx and asserts this table matches that set
//      exactly. Adding a hidden tab without choosing a back destination
//      fails CI instead of silently landing the user on Today.
//
// Deliberately a plain .ts module with a type-only expo-router import: the
// guard test imports it directly, and a type-only import is erased, so no
// React Native runtime is dragged into a pure-logic test.

import type { Href } from "expo-router";

/**
 * Keys are route names exactly as registered in app/(app)/_layout.tsx.
 * Values are where back goes.
 *
 * A single destination per route is a deliberate simplification. Several of
 * these screens have more than one entry point (see the notes below), and a
 * hidden tab cannot tell which one the user came through without threading
 * the origin through every navigation call. Picking the canonical parent is
 * the honest 90% fix; the accepted cost is that a secondary entry point
 * returns to the primary parent rather than to itself.
 */
export const HIDDEN_TAB_BACK_DESTINATIONS = {
  // Drawer-level screens whose parent genuinely is the Today dashboard.
  // Journal and Notes are NOT here: both are real Tabs.Screen entries in the
  // bar (see app/(app)/_layout.tsx), not hidden `href: null` routes, so
  // hardware back on either one is the tab navigator's own back behaviour,
  // not this table's concern.
  goals: "/",
  messages: "/",
  mentees: "/",
  library: "/",
  settings: "/",
  instructions: "/",

  // Detail routes: back belongs to the list that owns them, never to Today.
  // These are the ones users actually notice getting this wrong.
  "note/[id]": "/notes",
  // THE REPORTED BUG. Reached from the conversation list, from a mentee's
  // profile, from the Sharing list, from the notification centre, and from a
  // remote-push deep link into a cold app (deep-links.ts `conversation`).
  // Only the deep-link case has no meaningful history at all, and Messages is
  // the right landing for it as much as for the other four.
  "message/[id]": "/messages",
  "mentee/[id]": "/mentees",
  "library/[id]": "/library",

  // Pushed from Settings.
  "notification-settings": "/settings",
  categories: "/settings",

  // Two entries whose canonical parent is genuinely ambiguous, preserved as
  // they shipped rather than changed under cover of a bug fix:
  //   * `coach` is reached from Voice ("continue this in chat"), and also
  //     from Today's quick-access tile, Settings, the drawer, search and
  //     CoachHistorySheet. Voice is the flow the screen was built for.
  //   * `reports` is reached from Settings and also from Today's
  //     quick-access tile, the drawer and search.
  // Both currently return to the non-Today origin. Whether the Today
  // quick-access tile should win instead is a product call, not a defect —
  // see the report accompanying this change.
  coach: "/voice",
  reports: "/settings",

  // The notification centre is opened from the bell in the floating header
  // column, which renders on EVERY tab — so there is no single correct
  // parent, only a least-surprising one. Today is where the bell most often
  // gets tapped from and is the app's home. A genuinely correct fix needs
  // the origin captured at push time; that is a navigator rework, not a
  // table entry, and is called out as outstanding rather than faked here.
  notifications: "/",
} as const satisfies Record<string, Href>;

/** Route names exactly as registered with `href: null` in app/(app)/_layout.tsx. */
export type HiddenTabRoute = keyof typeof HIDDEN_TAB_BACK_DESTINATIONS;

/**
 * Back destination for a hidden tab. Takes the route's OWN name — the screen
 * says who it is, not where it goes — so the destination stays a property of
 * the table and a screen cannot quietly disagree with it.
 */
export function hiddenTabBackDestination(route: HiddenTabRoute): Href {
  return HIDDEN_TAB_BACK_DESTINATIONS[route];
}
