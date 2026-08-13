// One entry point the app calls whenever something the home-screen widget
// displays has changed, so callers never have to know which platform they're
// on or which of the two very different update mechanisms applies.
//
// The two platforms are NOT symmetrical, which is exactly why this wrapper
// exists rather than callers importing one or the other:
//
//   iOS      the widget is a separate process that cannot run this app's JS
//            at all. The app writes a snapshot into a shared App Group
//            container and asks WidgetKit to reload — see ios-widget-sync.ts.
//   Android  the widget is drawn from this same JS, either in a headless
//            task or (here) in-process — see android-widget-sync.tsx.
//
// Both are fire-and-forget and both swallow their own failures: a widget
// that fails to refresh must never surface an error into a screen the user
// is actually looking at. That's why this returns `void` and callers use
// `void syncWidgets()`.

import { Platform } from "react-native";

import { syncAndroidWidget } from "./android-widget-sync";
import { syncIOSWidget } from "./ios-widget-sync";

/**
 * Refreshes the home-screen widget on whichever platform this is.
 *
 * Call this after anything the widget shows changes — today's schedule, or
 * the tracking session (start/pause/resume/stop). Cheap enough to call
 * speculatively; both implementations re-read state themselves rather than
 * trusting the caller to pass it.
 */
export async function syncWidgets(): Promise<void> {
  try {
    if (Platform.OS === "ios") {
      await syncIOSWidget();
    } else if (Platform.OS === "android") {
      await syncAndroidWidget();
    }
  } catch {
    // Deliberately silent — see header. A widget refresh is never worth
    // interrupting the foreground app for.
  }
}
