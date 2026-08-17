// The single dispatcher for "the user tapped a notification", shared by the
// two places that can receive that tap:
//
//  1. app/_layout.tsx — an OS notification tapped from the tray/lock screen
//     (expo-notifications' `useLastNotificationResponse`).
//  2. app/(app)/notifications.tsx — a row tapped inside the in-app
//     notification center.
//
// These were previously two hand-written switches over the same resolver,
// and they drifted: the notification center called `resolveNotificationRoute`
// (a navigation-ONLY view over `resolveNotificationAction`, which by
// construction returns `null` for anything that isn't a `router.push`-able
// path), so APP_RELEASE rows — whose action is `open-url` or
// `check-for-update`, never `navigate` — resolved to `null` and tapping them
// did nothing at all. The row still got marked read, so the notification
// silently vanished without ever doing its job.
//
// Routing every tap through one function is the fix for the *class*, not
// just that instance: a new `NotificationTapAction` kind added to
// deep-links.ts now forces a compile error here (the switch is exhaustive
// over a closed union and the function has an explicit return type) instead
// of being silently dropped by whichever call site forgot about it.
//
// Deliberately free of react-native / expo-router imports: the side effects
// are injected as `handlers` so this stays a pure, directly-unit-testable
// function (see notification-tap.test.ts) rather than something that can
// only be exercised by rendering a screen.

import { resolveNotificationAction, type NotificationTapAction } from "./deep-links";

/**
 * The side effects a tap can produce. Injected rather than imported so the
 * dispatch logic can be tested without a navigator, a Linking module or an
 * OTA update server.
 */
export type NotificationTapHandlers = {
  /** An in-app route, already resolved to a path string by deep-links.ts. */
  navigate: (href: string) => void;
  /** An external http(s) URL — deep-links.ts has already scheme-checked it. */
  openUrl: (url: string) => void;
  /** A release notification carrying no URL: check for an OTA update now. */
  checkForUpdate: () => void;
};

/**
 * Resolves `data` (a notification's payload) and invokes exactly one handler.
 *
 * Returns the kind of action taken, or `null` when the payload isn't one this
 * build recognises — callers treat `null` as "no navigation", NOT as an
 * error: an older app receiving a notification type added by a newer server
 * should quietly do nothing rather than crash or show a failure.
 */
export function runNotificationTap(
  data: unknown,
  handlers: NotificationTapHandlers,
): NotificationTapAction["kind"] | null {
  const action = resolveNotificationAction(data);
  if (!action) {
    return null;
  }
  switch (action.kind) {
    case "navigate":
      handlers.navigate(action.href);
      return "navigate";
    case "open-url":
      handlers.openUrl(action.url);
      return "open-url";
    case "check-for-update":
      handlers.checkForUpdate();
      return "check-for-update";
  }
}
