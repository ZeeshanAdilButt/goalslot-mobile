// Where the floating Messages button is allowed to appear.
//
// Pure so it can be tested without a navigator (see
// floating-messages.test.ts) — the alternative is a chain of `pathname ===`
// checks inline in app/(app)/_layout.tsx, which is exactly the kind of
// condition that silently rots as routes are added.
//
// Two separate reasons a screen is on this list, and they are worth keeping
// distinct:
//
//   1. REDUNDANT. On Messages and inside a thread, a button that navigates to
//      Messages is at best noise and at worst covers the composer.
//   2. WRONGLY ANCHORED. note/[id], message/[id] and mentee/[id] set
//      `tabBarStyle: { display: "none" }` in the (app) layout, so the tab bar
//      the button docks above is not there. Left mounted, it would float in
//      the middle of nowhere — and on the note editor and the thread
//      composer, directly over a text input's own controls.
//
// The Messages screens themselves are covered by both.

/** Route prefixes that hide the tab bar the button docks above. */
const TAB_BAR_HIDDEN_PREFIXES = ["/note/", "/message/", "/mentee/"] as const;

/** Screens where a "go to Messages" button is redundant. */
const REDUNDANT_ON = ["/messages"] as const;

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
  return !TAB_BAR_HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
