package expo.modules.widgetbridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.widget.RemoteViews
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Keeps the "TRACKING" band on the Android home-screen widget ticking while
 * the app is backgrounded or fully killed — the actual fix for "elapsed
 * time / progress bar freeze while I'm just looking at my home screen".
 *
 * WHY THIS EXISTS AS A SEPARATE NATIVE PATH, rather than just firing
 * react-native-android-widget's existing JS-rendered redraw
 * (widget-task-handler.tsx / TodayWidget.tsx) more often:
 *
 *   1. That path spins up a headless JS task on every redraw. When the app
 *      process is still resident (the common "just backgrounded" case) that
 *      reuses the live bridge and is cheap — but when Android has actually
 *      killed the process (also a real case for a long-running session),
 *      it means a cold app start on every single tick. The existing
 *      30-minute `updatePeriodMillis` tick already pays that cost, but
 *      paying it every 60 seconds instead is a different order of expense.
 *   2. Every such redraw calls widget-data.ts's `loadWidgetTrackingState`,
 *      which hits the network (`fetchServerSession`, task/goal label
 *      resolution) — real requests, real battery/radio cost, every minute,
 *      for however long a session runs in the background. None of that is
 *      needed just to keep a *clock* moving.
 *
 * So this schedules itself with AlarmManager (survives the JS instance,
 * survives the process being killed — see LiveTrackingAlarmReceiver for the
 * boot/upgrade edge case) and redraws using ONLY arithmetic against a
 * timestamp persisted in LiveTrackingStore — no JS, no network, ever, on
 * this path. The label/secondary-label strings are a static snapshot from
 * whenever `start()` was last called (JS re-calls it if the label changes
 * mid-session — see android-live-tracking.ts) rather than something this
 * path re-resolves.
 *
 * This intentionally draws a SEPARATE, simpler view than TodayWidget.tsx's
 * full card (today's schedule header, block/progress body, tracking
 * footer) — reproducing that entire JSX-compiled-to-RemoteViews tree
 * natively in Kotlin would mean maintaining the same layout twice, in two
 * languages, and would still need react-native-android-widget's internal
 * (unstable, structurally-generated) view IDs to patch just the moving
 * parts, which the library does not expose. Trading that for a dedicated
 * "live tracking" card is deliberate: this only ever draws while a session
 * is actually RUNNING, which is also the one state where "what's being
 * tracked right now" is unambiguously the most useful thing the widget can
 * show. The instant the app is foregrounded again, or the session pauses/
 * stops/changes target, the normal JS `syncWidgets()` path (see
 * src/widgets/widget-sync.ts) redraws the full rich card and this native
 * path steps back (`stop()` cancels its alarm — see index.ts/
 * android-live-tracking.ts callers in timer.tsx).
 */
internal object LiveTrackingScheduler {
  /** Matches RUNNING_SYNC_INTERVAL_MS in src/widgets/widget-sync.ts — same cadence, native or JS-driven. */
  private const val TICK_INTERVAL_MS = 60_000L

  /** Same cycle length as widget-data.ts's PROGRESS_CYCLE_MS — the "timer bar" fills once per hour of elapsed time, not a completion percentage. */
  private const val PROGRESS_CYCLE_MS = 60 * 60 * 1000L

  /** Fractional precision for the ProgressBar (0..PROGRESS_MAX instead of 0..1 — Android's ProgressBar only takes integers). */
  private const val PROGRESS_MAX = 1000

  /** Must match `timerDeepLink()` in src/lib/deep-links.ts (`goalslot://timer`) — tapping the live card opens the same screen the JS-rendered widget's tracking state opens to. */
  private const val TIMER_DEEP_LINK = "goalslot://timer"

  private const val TICK_REQUEST_CODE = 4001

  /** Explicit-component intent for the recurring tick — see AndroidManifest.xml's header comment for why this needs no intent-filter action. */
  private fun tickPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, LiveTrackingAlarmReceiver::class.java).setAction(ACTION_TICK)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, TICK_REQUEST_CODE, intent, flags)
  }

  const val ACTION_TICK = "expo.modules.widgetbridge.LIVE_TRACKING_TICK"

  /** Called from the JS bridge (WidgetBridgeModule) on start/resume, and from itself isn't re-entered by the receiver — the receiver calls `redrawAndReschedule` directly instead, since it already knows a tick just fired. */
  fun start(context: Context, taskName: String, secondaryLabel: String?, startedAtMs: Long, pausedElapsedMs: Long) {
    LiveTrackingStore.save(context, taskName, secondaryLabel, startedAtMs, pausedElapsedMs)
    // Redraw immediately — otherwise the widget would sit on whatever it
    // last showed (e.g. "0m" from the moment-of-start JS sync, which fires
    // separately and may not have landed yet) for a full TICK_INTERVAL_MS
    // before this path draws anything.
    redrawWidget(context)
    scheduleNextTick(context)
  }

  /** Called from the JS bridge on pause/stop. Idempotent — cancelling an alarm that was never scheduled, or that already fired, is a harmless no-op. */
  fun stop(context: Context) {
    LiveTrackingStore.clear(context)
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarmManager.cancel(tickPendingIntent(context))
  }

  /** Redraws now, then schedules the next tick — but only while the persisted state still says a session is running. Called by LiveTrackingAlarmReceiver on every alarm fire and boot/upgrade. */
  fun redrawAndReschedule(context: Context) {
    val state = LiveTrackingStore.read(context)
    if (!state.isRunning) return
    redrawWidget(context)
    scheduleNextTick(context)
  }

  private fun scheduleNextTick(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val triggerAtElapsed = SystemClock.elapsedRealtime() + TICK_INTERVAL_MS
    val pendingIntent = tickPendingIntent(context)

    // A 60s cadence has no need for to-the-second precision, so this always
    // prefers the INEXACT variant — `setAndAllowWhileIdle` still fires
    // during Doze (unlike a plain `set`), it just isn't pinned to the exact
    // millisecond, which Doze can stretch somewhat under real-world battery
    // optimisation. That's an acceptable trade for never needing the
    // SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM permission dance for this
    // feature specifically. (Those permissions ARE already declared in
    // app.json for expo-notifications' reminder alarms, which genuinely
    // need to land on the minute — this scheduler doesn't piggyback on that
    // budget on purpose, since a widget tick being a little late is a
    // cosmetic non-issue, unlike a missed schedule reminder.)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtElapsed, pendingIntent)
    } else {
      alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtElapsed, pendingIntent)
    }
  }

  private fun redrawWidget(context: Context) {
    val state = LiveTrackingStore.read(context)
    if (!state.isRunning) return

    val appWidgetManager = AppWidgetManager.getInstance(context)
    // The provider class react-native-android-widget's config plugin
    // generates at prebuild time for app.json's `"name": "TodayWidget"`
    // entry — see node_modules/react-native-android-widget/app.plugin.js's
    // `getReceiverInfo`/`withWidgetProviderClass` (receiver package
    // defaults to "<applicationId>.widget", class name is the widget's
    // `name`). That generated class lives in the gitignored, prebuild-only
    // `android/` project, not in this Expo module, so it can't be
    // referenced by type here — targeted by fully-qualified name instead,
    // derived from the running app's own package so this still works under
    // a different applicationId (dev client, etc.) without editing this
    // module.
    val provider = ComponentName(context.packageName, "${context.packageName}.widget.TodayWidget")
    val appWidgetIds = appWidgetManager.getAppWidgetIds(provider)
    if (appWidgetIds.isEmpty()) return // No copy of the widget on any home screen right now.

    val elapsedMs = state.pausedElapsedMs + max(0L, System.currentTimeMillis() - state.startedAtMs)
    val elapsedMinutes = elapsedMs / 60_000L
    val progressFraction = (elapsedMs % PROGRESS_CYCLE_MS).toFloat() / PROGRESS_CYCLE_MS.toFloat()

    val remoteViews = buildRemoteViews(
      context = context,
      taskName = state.taskName,
      secondaryLabel = state.secondaryLabel,
      elapsedLabel = formatDuration(elapsedMinutes),
      progressFraction = progressFraction,
    )
    appWidgetManager.updateAppWidget(appWidgetIds, remoteViews)
  }

  /** Mirrors formatDuration(minutes) in packages/shared/src/scheduling/time.ts exactly ("1h 21m" / "45m" / "2h") — kept in lockstep by hand since native code can't import that TS module. */
  private fun formatDuration(totalMinutes: Long): String {
    if (totalMinutes < 0) return "0m"
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return when {
      hours == 0L -> "${minutes}m"
      minutes == 0L -> "${hours}h"
      else -> "${hours}h ${minutes}m"
    }
  }

  private fun buildRemoteViews(
    context: Context,
    taskName: String,
    secondaryLabel: String?,
    elapsedLabel: String,
    progressFraction: Float,
  ): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_bridge_live_tracking)

    views.setTextViewText(R.id.widget_bridge_title, taskName.ifBlank { "Untitled session" })
    views.setTextViewText(R.id.widget_bridge_elapsed, elapsedLabel)

    if (secondaryLabel.isNullOrBlank()) {
      views.setViewVisibility(R.id.widget_bridge_secondary, android.view.View.GONE)
    } else {
      views.setViewVisibility(R.id.widget_bridge_secondary, android.view.View.VISIBLE)
      views.setTextViewText(R.id.widget_bridge_secondary, secondaryLabel)
    }

    val clamped = progressFraction.coerceIn(0f, 1f)
    views.setProgressBar(R.id.widget_bridge_progress, PROGRESS_MAX, (clamped * PROGRESS_MAX).roundToInt(), false)

    val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(TIMER_DEEP_LINK)).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val openFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val openPendingIntent = PendingIntent.getActivity(context, TICK_REQUEST_CODE, openIntent, openFlags)
    views.setOnClickPendingIntent(R.id.widget_bridge_root, openPendingIntent)

    return views
  }
}
