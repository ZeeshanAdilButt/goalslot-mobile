// Destination list behind the Today screen's quick-access rail
// (QuickAccessRail.tsx).
//
// WHY THIS IS DATA AND NOT JUST JSX: the four destinations here are the four
// screens that had no above-the-fold entry point at all. Notes and Reports
// DO have tiles — but they live in the "Jump back in" grid, which is the
// last child of Today's ScrollView, below the hero, the journal prompt, the
// 2x2 stat grid and three full list sections. On an account with real data
// that's two-plus screens of scrolling, which is the same thing as not
// existing. Sharing and Coach were worse: neither had a Today entry at all,
// only the hamburger drawer and the search overlay.
//
// Keeping the list as an exported array (rather than inline in the rail's
// JSX) is what lets quick-access.test.ts assert that every `href` is a route
// this app actually has — apps/mobile has no @testing-library/react-native,
// so a rendered tap-through test is not writable here and a data-level check
// is the coverage that IS available. See that file's header.
//
// "Shared" is /mentees on purpose, and it is NOT a new screen: mentees.tsx
// is already the shared-with-me direction of the sharing graph
// (`sharingQueries.sharedWithMe()`), and each row on it has a "Reports"
// button that opens /mentee/{ownerId} — a real reports view over that
// person's shared time entries and goals. There is no aggregate
// "everyone's reports" screen and none is coherent, since a report needs an
// ownerId. The label says "Shared" rather than "Mentees" to match what the
// rest of the app calls that route: _layout.tsx's Tabs.Screen title,
// DrawerContent's nav entry and search-index.ts all say "Sharing".

import type { Href } from "expo-router";

import type { IconName } from "@/components/ui/Icon";

export interface QuickAccessItem {
  /** Stable key; also the id search-index.ts uses for the same destination. */
  id: string;
  /** One word — the rail gives each item a quarter of the screen width. */
  label: string;
  icon: IconName;
  href: Href;
  /** Spoken label; the visible one-word caption is too terse on its own. */
  accessibilityLabel: string;
}

// Four, not three or five: four items divide a phone's width into columns
// wide enough for a 40pt badge plus a caption that doesn't truncate, and
// these are exactly the four off-tab destinations that were hard to reach.
// Everything else on Today's "Jump back in" grid (Schedule, Timer, Journal,
// Settings) either has a tab, a FAB entry or a card of its own above the
// fold already.
export const QUICK_ACCESS_ITEMS: readonly QuickAccessItem[] = [
  {
    id: "notes",
    label: "Notes",
    icon: "notes",
    href: "/notes" as Href,
    accessibilityLabel: "Open notes",
  },
  {
    id: "reports",
    label: "Reports",
    icon: "reports",
    href: "/reports" as Href,
    accessibilityLabel: "Open your reports",
  },
  {
    id: "mentees",
    label: "Shared",
    icon: "mentees",
    href: "/mentees" as Href,
    accessibilityLabel: "Open reports people have shared with you",
  },
  {
    id: "coach",
    label: "Coach",
    icon: "coach",
    href: "/coach" as Href,
    accessibilityLabel: "Open Coach AI",
  },
];
