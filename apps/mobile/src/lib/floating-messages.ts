// Where the floating Messages button is allowed to appear.
//
// Pure so it can be tested without a navigator (see
// floating-messages.test.ts) — the alternative is a chain of `pathname ===`
// checks inline in app/(app)/_layout.tsx, which is exactly the kind of
// condition that silently rots as routes are added.
//
// Three separate reasons a screen is on this list, and they are worth
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
//
// The Messages screens themselves are covered by reason 1.

/** Route prefixes that hide the tab bar the button docks above. */
const TAB_BAR_HIDDEN_PREFIXES = ["/note/", "/message/", "/mentee/"] as const;

/** Screens where a "go to Messages" button is redundant. */
const REDUNDANT_ON = ["/messages"] as const;

/** Screens whose own bottom-right FAB this button would otherwise sit on top of. */
const OWNS_THE_CORNER = ["/", "/goals", "/tasks", "/schedule"] as const;

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
  return !TAB_BAR_HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
