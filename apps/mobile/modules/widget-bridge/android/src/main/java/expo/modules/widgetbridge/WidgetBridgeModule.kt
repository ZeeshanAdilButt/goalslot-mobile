package expo.modules.widgetbridge

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart to WidgetBridgeModule.swift. The two share the
 * "WidgetBridge" native module name (see expo-module.config.json) but expose
 * entirely different functions — iOS bridges JS state into the WidgetKit App
 * Group container (`setState`/`reload`); Android has no equivalent need
 * (react-native-android-widget already gets its data through its own headless
 * JS task) EXCEPT for one gap: keeping the "TRACKING" band's elapsed time
 * moving while the app is backgrounded or killed, which needs a native
 * AlarmManager scheduler no JS-only mechanism can provide. See
 * LiveTrackingScheduler's header for the design and for what an earlier
 * version got wrong.
 *
 * `startLiveTrackingV2` is versioned in its NAME on purpose, and the old
 * `startLiveTracking` is gone rather than reimplemented. The previous version
 * shipped inside an installed APK that can only be replaced by a manual
 * reinstall, so JS has to be able to tell the two builds apart at runtime:
 * modules/widget-bridge/index.ts feature-detects this function and stays
 * disabled on any build that only offers the old one. Renaming is what makes
 * that detection possible — do not "tidy" it back to `startLiveTracking`
 * while a build carrying the old implementation may still be installed.
 */
class WidgetBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    // No payload: the widget's content is resolved by the headless JS render
    // this schedules, not by anything passed across the bridge here.
    Function("startLiveTrackingV2") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      LiveTrackingScheduler.start(context)
    }

    Function("stopLiveTracking") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      LiveTrackingScheduler.stop(context)
    }
  }
}
