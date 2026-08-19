import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

// Both platforms register a native module under the same "WidgetBridge" name
// (see expo-module.config.json) but for entirely different reasons and with
// entirely different function surfaces — the two `requireOptionalNativeModule`
// calls below are typed separately rather than sharing one interface.
//
//   iOS      bridges JS state into the WidgetKit App Group container
//            (`setState`/`reload`) — the widget is a separate process that
//            can't run this app's JS at all, so this is the only channel.
//   Android  react-native-android-widget already gets its data through its
//            own headless JS task, so this module has nothing to do with
//            the widget's actual content. It exists solely to run a native
//            AlarmManager scheduler (`startLiveTracking`/`stopLiveTracking`)
//            that keeps the "TRACKING" band's elapsed time/progress bar
//            ticking once a minute while the app is backgrounded or fully
//            killed — see modules/widget-bridge/android's
//            LiveTrackingScheduler.kt for the full design rationale, and
//            src/widgets/android-live-tracking.ts for the JS-side wrapper
//            timer.tsx actually calls.

interface WidgetBridgeIOSModule {
  setState(json: string): void;
  reload(): void;
}

/** Mirrors android/.../WidgetBridgeModule.kt's `LiveTrackingPayload` Record. */
export interface LiveTrackingPayload {
  taskName: string;
  secondaryLabel?: string;
  startedAtMs: number;
  pausedElapsedMs: number;
}

interface WidgetBridgeAndroidModule {
  startLiveTracking(payload: LiveTrackingPayload): void;
  stopLiveTracking(): void;
}

const iosModule =
  Platform.OS === "ios" ? requireOptionalNativeModule<WidgetBridgeIOSModule>("WidgetBridge") : null;
const androidModule =
  Platform.OS === "android" ? requireOptionalNativeModule<WidgetBridgeAndroidModule>("WidgetBridge") : null;

/** Writes the given widget-state JSON into the shared App Group container. No-ops on Android or if the native module isn't linked (e.g. Expo Go). */
export function setIOSWidgetState(json: string): void {
  iosModule?.setState(json);
}

/** Asks WidgetKit to redraw immediately instead of waiting for its own timeline policy. */
export function reloadIOSWidgets(): void {
  iosModule?.reload();
}

/**
 * Starts (or re-anchors, if already running) the native tick that keeps the
 * Android widget's live tracking band moving while this app's JS isn't
 * alive to do it. No-ops on iOS or if the native module isn't linked (e.g.
 * Expo Go, which can't carry custom native modules at all).
 */
export function startAndroidLiveTracking(payload: LiveTrackingPayload): void {
  androidModule?.startLiveTracking(payload);
}

/** Stops the native tick — call on pause/stop, matching src/lib/timer-store.ts's own status transitions. */
export function stopAndroidLiveTracking(): void {
  androidModule?.stopLiveTracking();
}
