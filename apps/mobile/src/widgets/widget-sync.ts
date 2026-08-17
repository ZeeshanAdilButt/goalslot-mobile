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
 * How often callers should re-push a widget redraw while a tracking session
 * is RUNNING, on top of the once-per-transition calls `syncWidgets()` gets
 * everywhere else. Neither widget mechanism (Android's RemoteViews via
 * `updatePeriodMillis`, iOS's WidgetKit `Timeline`) redraws itself as time
 * passes — both are pushed, not live — so without a periodic call the
 * progress bar/elapsed text are only ever as fresh as the last start,
 * pause, resume, or foreground event, and visibly stop advancing while a
 * session just sits there running. See the callers in `app/(app)/_layout.tsx`
 * and `app/(app)/timer.tsx` for the two triggers (local-store and
 * server-session transitions respectively) this closes the gap between.
 *
 * 60s matches the granularity the widget actually renders at (minutes) and
 * is cheap either way: a local re-read plus an in-process `RemoteViews` push
 * on Android, or a `WidgetKit` reload request on iOS — no network call.
 *
 * This only helps while the calling JS is actually alive (foregrounded, or
 * briefly backgrounded before the OS suspends RN timers) — it cannot reach
 * the "app fully closed" case. Closing that needs a native scheduler
 * (AlarmManager on Android, a BGAppRefreshTask on iOS), which is a separate,
 * non-OTA-shippable change.
 */
export const RUNNING_SYNC_INTERVAL_MS = 60_000;

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
