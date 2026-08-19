// Thin wrapper around widget-bridge's native Android scheduler — the piece
// that keeps the home-screen widget's "TRACKING" band refreshing while this
// app's JS isn't alive to do it (backgrounded, or fully killed by the OS).
// See modules/widget-bridge/android/.../LiveTrackingScheduler.kt for the
// design rationale and modules/widget-bridge/index.ts for the native call
// surface this wraps.
//
// Deliberately separate from src/widgets/widget-sync.ts's `syncWidgets()`:
// that redraws the widget through JS on every start/pause/resume/stop
// transition and every RUNNING_SYNC_INTERVAL_MS while foregrounded. This only
// tells the native side "a session is running" or "stop" — the alarm it arms
// then asks the widget provider to redraw itself on its own schedule, with no
// further JS involvement from this side. Both run side by side rather than
// one replacing the other: the JS path still owns every redraw it is alive to
// produce.
//
// EVERY CALL IS GATED ON `androidLiveTrackingSupported`, and that is not
// belt-and-braces. An earlier native build shipped a scheduler that drew its
// own RemoteViews card and broke the home-screen widget outright ("Couldn't
// add widget."). That build is installed on real devices and can only be
// replaced by a manual reinstall, while this JS reaches every device the
// moment it is published — so the guard is what stops a device on the old
// APK from re-arming the broken path.

import { Platform } from "react-native";

import {
  androidLiveTrackingSupported,
  startAndroidLiveTracking as bridgeStart,
  stopAndroidLiveTracking as bridgeStop,
} from "widget-bridge";

/** Starts (or re-anchors) the native tick. No-ops on iOS, in Expo Go, and on any build without the current native scheduler. */
export function startAndroidLiveTracking(): void {
  if (Platform.OS !== "android") return;
  if (!androidLiveTrackingSupported) {
    // Old native build: make sure nothing it may have armed earlier is still
    // running, rather than simply doing nothing.
    bridgeStop();
    return;
  }
  bridgeStart();
}

/** Stops the native tick. Safe on every build — `stopLiveTracking` exists in both the old and current native modules. */
export function stopAndroidLiveTracking(): void {
  if (Platform.OS !== "android") return;
  bridgeStop();
}
