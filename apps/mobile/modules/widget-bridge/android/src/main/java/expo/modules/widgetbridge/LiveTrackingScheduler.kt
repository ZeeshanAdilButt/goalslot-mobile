package expo.modules.widgetbridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * Keeps the home-screen widget's "TRACKING" band from freezing while the app
 * is backgrounded or fully killed.
 *
 * react-native-android-widget's own periodic update is clamped to 30 minutes
 * (`updatePeriodMillis` in app.json), and the JS-side `setInterval` in
 * timer.tsx/_layout.tsx only runs while this app's JS is alive. So once
 * Android backgrounds or kills the process, elapsed time sits at whatever it
 * last showed. This schedules an AlarmManager tick that survives both.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — read before changing it.
 *
 * The first version of this class drew its OWN RemoteViews card, from a
 * layout in this module (`widget_bridge_live_tracking.xml`), so a tick could
 * redraw using nothing but arithmetic — no JS, no network. That shipped and
 * broke the widget outright: the launcher intermittently replaced it with
 * "Couldn't add widget." RemoteViews is inflated in the LAUNCHER's process
 * against the LAUNCHER's theme, so anything that fails to resolve there takes
 * the whole widget down rather than degrading; the ProgressBar's
 * `?android:attr/progressBarStyleHorizontal` theme-attribute reference was the
 * prime suspect. Pushing a second, independently-maintained layout at a widget
 * that already has a working one was the mistake, not the detail that broke.
 *
 * So a tick now just broadcasts APPWIDGET_UPDATE at the provider and lets the
 * EXISTING, already-working renderer draw. There is no custom layout, no
 * second copy of the card's design, and nothing for the launcher to fail to
 * inflate — the only view tree involved is the one that renders today.
 *
 * The cost is that each tick spins up react-native-android-widget's headless
 * JS task, which re-runs widget-data.ts's `loadWidgetTrackingState` (real
 * network calls). That is why the interval here is minutes rather than the 60s
 * the JS-side foreground sync uses: a widget clock that is a few minutes stale
 * is fine, waking the radio every minute for hours is not.
 */
internal object LiveTrackingScheduler {
  /**
   * Deliberately coarser than widget-sync.ts's 60s foreground interval —
   * every tick here is a headless JS start plus the network fetches that come
   * with it, where the foreground one reuses a live bridge. Five minutes keeps
   * the displayed elapsed time honest to within a rounding error of the "Nm"
   * label the band shows, at a twelfth of the wakeups.
   */
  private const val TICK_INTERVAL_MS = 5 * 60 * 1000L

  private const val TICK_REQUEST_CODE = 4001

  const val ACTION_TICK = "expo.modules.widgetbridge.LIVE_TRACKING_TICK"

  /**
   * The provider class react-native-android-widget's config plugin generates
   * at prebuild time for app.json's `"name": "TodayWidget"` entry — receiver
   * package defaults to "<applicationId>.widget", class name is the widget's
   * `name`. That generated class lives in the gitignored, prebuild-only
   * `android/` project rather than in this module, so it cannot be referenced
   * by type here; it is targeted by fully-qualified name, derived from the
   * running app's own package so this still works under a different
   * applicationId (dev client, etc.) without editing this module.
   */
  private fun widgetProvider(context: Context) =
    ComponentName(context.packageName, "${context.packageName}.widget.TodayWidget")

  /** Explicit-component intent for the recurring tick — see AndroidManifest.xml's header comment for why this needs no intent-filter action. */
  private fun tickPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, LiveTrackingAlarmReceiver::class.java).setAction(ACTION_TICK)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, TICK_REQUEST_CODE, intent, flags)
  }

  /**
   * Called from the JS bridge on start/resume. Only records that a session is
   * running and arms the alarm — it does NOT force an immediate refresh,
   * because JS has just transitioned the timer and `syncWidgets()` is already
   * redrawing the widget on its own for exactly this event. Refreshing here
   * too would mean two headless JS renders back to back for one transition.
   */
  fun start(context: Context) {
    LiveTrackingStore.setRunning(context, true)
    scheduleNextTick(context)
  }

  /** Called from the JS bridge on pause/stop. Idempotent — cancelling an alarm that was never scheduled, or already fired, is a harmless no-op. */
  fun stop(context: Context) {
    LiveTrackingStore.setRunning(context, false)
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarmManager.cancel(tickPendingIntent(context))
  }

  /** Refreshes now and schedules the next tick — but only while the persisted state still says a session is running. Called by LiveTrackingAlarmReceiver on every alarm fire and on boot/upgrade. */
  fun refreshAndReschedule(context: Context) {
    if (!LiveTrackingStore.isRunning(context)) return
    requestWidgetRefresh(context)
    scheduleNextTick(context)
  }

  private fun scheduleNextTick(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val triggerAtElapsed = SystemClock.elapsedRealtime() + TICK_INTERVAL_MS
    val pendingIntent = tickPendingIntent(context)

    // Always the INEXACT variant: `setAndAllowWhileIdle` still fires during
    // Doze (unlike a plain `set`), it just isn't pinned to the millisecond,
    // which is an easy trade for never needing the SCHEDULE_EXACT_ALARM /
    // USE_EXACT_ALARM permission dance. Those permissions ARE already declared
    // app-wide for expo-notifications' reminder alarms, which genuinely have
    // to land on the minute — a widget clock running a little late is
    // cosmetic, so this does not spend from that budget.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtElapsed, pendingIntent)
    } else {
      alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtElapsed, pendingIntent)
    }
  }

  /**
   * Hands the redraw to react-native-android-widget's own provider rather
   * than drawing anything here — see this class's header for why that is the
   * whole point of this version.
   */
  private fun requestWidgetRefresh(context: Context) {
    val appWidgetManager = AppWidgetManager.getInstance(context) ?: return
    val appWidgetIds = appWidgetManager.getAppWidgetIds(widgetProvider(context))
    // No copy of the widget on any home screen — nothing to refresh, and the
    // alarm can stand down until the next start().
    if (appWidgetIds.isEmpty()) return

    val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
      .setComponent(widgetProvider(context))
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds)
    context.sendBroadcast(intent)
  }
}
