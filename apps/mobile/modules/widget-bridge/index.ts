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
//            AlarmManager scheduler (`startLiveTrackingV2`/`stopLiveTracking`)
//            that keeps the "TRACKING" band's elapsed time/progress bar
//            refreshing every few minutes while the app is backgrounded or
//            fully killed — see modules/widget-bridge/android's
//            LiveTrackingScheduler.kt for the full design rationale, and
//            src/widgets/android-live-tracking.ts for the JS-side wrapper
//            timer.tsx actually calls.

interface WidgetBridgeIOSModule {
  setState(json: string): void;
  reload(): void;
}

interface WidgetBridgeAndroidModule {
  /**
   * Optional because it only exists in builds carrying the CURRENT native
   * scheduler. An older APK — one that is already installed and can only be
   * replaced by a manual reinstall — exposes a `startLiveTracking` whose
   * implementation draws its own RemoteViews card and breaks the widget
   * outright. This update reaches both builds over the air, so the name is
   * the runtime signal that tells them apart; see
   * `androidLiveTrackingSupported` below.
   */
  startLiveTrackingV2?: () => void;
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
 * True only on an Android build whose native module carries the current
 * scheduler. False on iOS, in Expo Go (no custom native modules at all), and
 * — the case this exists for — on an older installed APK whose native code
 * would break the home-screen widget. Callers must check this rather than
 * assuming the native side matches the JS they are running: an over-the-air
 * update replaces the JS on every device, but the native half only changes
 * when someone installs a new build.
 */
export const androidLiveTrackingSupported = typeof androidModule?.startLiveTrackingV2 === "function";

/**
 * Starts (or re-anchors, if already running) the native tick that keeps the
 * Android widget's tracking band refreshing while this app's JS isn't alive
 * to do it. No-ops wherever `androidLiveTrackingSupported` is false.
 */
export function startAndroidLiveTracking(): void {
  androidModule?.startLiveTrackingV2?.();
}

/** Stops the native tick — call on pause/stop, matching src/lib/timer-store.ts's own status transitions. */
export function stopAndroidLiveTracking(): void {
  androidModule?.stopLiveTracking();
}
