// Where the floating Messages button is allowed to appear.
//
// Pure so it can be tested without a navigator (see
// floating-messages.test.ts) — the alternative is a chain of `pathname ===`
// checks inline in app/(app)/_layout.tsx, which is exactly the kind of
// condition that silently rots as routes are added.
//
// Four separate reasons a screen is on this list, and they are worth
// keeping distinct:
//
//   1. REDUNDANT. On Messages and inside a thread, a button that navigates to
//      Messages is at best noise and at worst covers the composer.
//   2. WRONGLY ANCHORED. note/[id], message/[id] and mentee/[id] set
//      `tabBarStyle: { display: "none" }` in the (app) layout, so the tab bar
//      the button docks above is not there. Left mounted, it would float in
//      the middle of nowhere — and on the note editor and the thread
//      composer, directly over a text input's own controls.
//   3. CORNER ALREADY OWNED. Today, Goals, Tasks and Schedule each have
//      their own primary "create" FAB pinned at the identical
//      right:spacing.xl / bottom:spacing.xxl corner this button docks in
//      (see each screen's own `fab` style). This button was reasoned
//      through three OTHER placements before picking that corner — see
//      FloatingMessagesButton's own header — but never checked against a
//      screen's pre-existing FAB there, so it launched sitting directly on
//      top of the one button those four screens actually need pressed.
//      Reported by the user as "the messages icon is hiding the plus
//      button." Same root shape as the Notes scroll-to-top button's
//      collision with per-row controls fixed earlier the same day — a new
//      floating element has to be checked against what a screen already
//      docks in that corner, not just against the tab bar and the other
//      candidate placements.
//   4. OBSCURES OWN CONTENT. Journal has no competing button in this corner
//      — the collision here is with CONTENT, not a control. journal.tsx
//      renders its date-nav row, voice-capture invite, the editor card and
//      the "Recent entries" heading + first row(s) all inside ONE FlashList
//      (the editor stack is its `ListHeaderComponent`), and that stack alone
//      runs to roughly 470-500pt before any entry row appears. On a typical
//      phone viewport that leaves only the screen's last ~150-200pt for
//      "Recent entries" — squarely inside the ~50-65pt band directly above
//      the tab bar this button docks in, on first paint, before any
//      scrolling. Reported by the user as "the right icon hides under
//      notifications": the button sits on top of the "RECENT ENTRIES"
//      label and the top of the first entry row, both visually (painted
//      over the FlashList since the button is a sibling overlay outside the
//      scroll view, so it never moves as the list scrolls under it) and for
//      touch (its 44pt hitbox + hitSlop 8 intercepts taps meant for the
//      row's own onPress/swipe-to-delete). Not a REDUNDANT case (Journal is
//      an ordinary screen the button should still be reachable from) and
//      not CORNER-ALREADY-OWNED (Journal has no FAB of its own there) —
//      the reason this button has to disappear here is unique enough to
//      warrant its own list rather than folding into #3.
//
// The Messages screens themselves are covered by reason 1.

/** Route prefixes that hide the tab bar the button docks above. */
const TAB_BAR_HIDDEN_PREFIXES = ["/note/", "/message/", "/mentee/"] as const;

/** Screens where a "go to Messages" button is redundant. */
const REDUNDANT_ON = ["/messages"] as const;

/** Screens whose own bottom-right FAB this button would otherwise sit on top of. */
const OWNS_THE_CORNER = ["/", "/goals", "/tasks", "/schedule"] as const;

/**
 * Screens whose own bottom-of-scroll CONTENT (not a control) this button's
 * fixed footprint would otherwise sit on top of. See reason 4 above.
 */
const OBSCURES_OWN_CONTENT = ["/journal"] as const;

/**
 * @param pathname expo-router's `usePathname()` — a path with no query string.
 * @param messagingEnabled build-time config (src/lib/messaging-config.ts). A
 *   build with no messaging service must not float a button to a screen that
 *   can only ever say "unavailable" — the drawer already omits its row on the
 *   same basis.
 */
export function shouldShowFloatingMessagesButton(pathname: string, messagingEnabled: boolean): boolean {
  if (!messagingEnabled) return false;
  if (REDUNDANT_ON.some((route) => pathname === route)) return false;
  if (OWNS_THE_CORNER.some((route) => pathname === route)) return false;
  if (OBSCURES_OWN_CONTENT.some((route) => pathname === route)) return false;
  return !TAB_BAR_HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Whether the header button column (menu/search/bell, top-right — see
 * app/(app)/_layout.tsx) should carry its own small Messages icon.
 *
 * Exactly the OWNS_THE_CORNER screens, and no others: those are the only
 * ones where `shouldShowFloatingMessagesButton` above is false SPECIFICALLY
 * because the floating button would sit on the screen's own FAB, not for
 * some other reason (redundant, obscures content, tab bar hidden) — so
 * they're the only screens that lose Messages reachability entirely without
 * a substitute. Reported by the user as "the floating icon from messaging
 * is gone" on Today, after the OWNS_THE_CORNER exclusion above shipped:
 * removing the collision also removed the only way to reach Messages from
 * these four screens (menus aside), which is a real regression the header
 * icon exists to close. Every other excluded screen keeps its existing,
 * correct substitute: Messages itself needs no button to itself, the note/
 * message/mentee detail screens have no tab bar to dock a header column
 * above in the first place, and Journal's own content push-down problem has
 * nothing to do with reachability — the drawer's Messages row already
 * covers it there, same as it does everywhere.
 */
export function shouldShowHeaderMessagesIcon(pathname: string, messagingEnabled: boolean): boolean {
  if (!messagingEnabled) return false;
  return OWNS_THE_CORNER.some((route) => pathname === route);
}
