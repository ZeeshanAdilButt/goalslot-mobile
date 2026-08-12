import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

// Optional: the native module only exists on iOS (see expo-module.config.json
// — no "android" platform entry, matching that the WidgetKit extension this
// bridges to is iOS-only; Android's widget already gets its data through
// react-native-android-widget's own headless task, not this module).
interface WidgetBridgeNativeModule {
  setState(json: string): void;
  reload(): void;
}

const nativeModule =
  Platform.OS === "ios" ? requireOptionalNativeModule<WidgetBridgeNativeModule>("WidgetBridge") : null;

/** Writes the given widget-state JSON into the shared App Group container. No-ops on Android or if the native module isn't linked (e.g. Expo Go). */
export function setIOSWidgetState(json: string): void {
  nativeModule?.setState(json);
}

/** Asks WidgetKit to redraw immediately instead of waiting for its own timeline policy. */
export function reloadIOSWidgets(): void {
  nativeModule?.reload();
}
