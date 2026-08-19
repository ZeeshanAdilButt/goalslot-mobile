package expo.modules.widgetbridge

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * JS-callable payload for `startLiveTracking` — see index.ts's
 * `LiveTrackingPayload` (the mirrored TS shape) and
 * src/widgets/android-live-tracking.ts's `buildLiveTrackingPayload` for how
 * callers construct it. `startedAtMs`/`pausedElapsedMs` come across the
 * bridge as doubles (JS has no distinct integer type) and are rounded to
 * Long here, same as any other JS timestamp crossing into native code.
 */
class LiveTrackingPayload : Record {
  @Field
  val taskName: String = ""

  @Field
  val secondaryLabel: String? = null

  @Field
  val startedAtMs: Double = 0.0

  @Field
  val pausedElapsedMs: Double = 0.0
}

/**
 * Android counterpart to WidgetBridgeModule.swift. The two share the
 * "WidgetBridge" native module name (see expo-module.config.json) but
 * expose entirely different functions — iOS bridges JS state into the
 * WidgetKit App Group container (`setState`/`reload`); Android has no
 * equivalent need (react-native-android-widget already gets its data
 * through its own headless JS task) EXCEPT for this one gap: keeping the
 * "TRACKING" band ticking while the app is backgrounded or killed, which
 * needs a native AlarmManager scheduler no JS-only mechanism can provide.
 * See LiveTrackingScheduler's header comment for the full design rationale.
 */
class WidgetBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    Function("startLiveTracking") { payload: LiveTrackingPayload ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      LiveTrackingScheduler.start(
        context = context,
        taskName = payload.taskName,
        secondaryLabel = payload.secondaryLabel,
        startedAtMs = payload.startedAtMs.toLong(),
        pausedElapsedMs = payload.pausedElapsedMs.toLong(),
      )
    }

    Function("stopLiveTracking") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      LiveTrackingScheduler.stop(context)
    }
  }
}
