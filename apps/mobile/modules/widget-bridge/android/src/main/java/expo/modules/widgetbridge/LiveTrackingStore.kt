package expo.modules.widgetbridge

import android.content.Context
import android.content.SharedPreferences

/**
 * The persisted state the native alarm receiver needs to redraw the widget
 * without ever calling back into JS — see LiveTrackingScheduler's header for
 * why. Plain SharedPreferences, not the app's own AsyncStorage/SecureStore
 * (both are JS-side abstractions this native-only code path deliberately
 * doesn't depend on): this only has to survive process death, which
 * SharedPreferences already does on its own.
 *
 * Mirrors the fields timer-store.ts's `getElapsedMs` needs (`startedAt`,
 * `pausedElapsedMs`) plus the two label strings TodayWidget.tsx's
 * TrackingBand shows — nothing else. Deliberately NOT the full
 * WidgetTrackingState shape from widget-data.ts: that also carries goalId/
 * taskId/progress, none of which this native path needs (progress is
 * recomputed from elapsed, and there is no goal/task-specific action here to
 * attribute).
 */
internal data class LiveTrackingState(
  val isRunning: Boolean,
  val taskName: String,
  val secondaryLabel: String?,
  val startedAtMs: Long,
  val pausedElapsedMs: Long,
)

internal object LiveTrackingStore {
  private const val PREFS_NAME = "expo.modules.widgetbridge.live_tracking"

  private const val KEY_IS_RUNNING = "is_running"
  private const val KEY_TASK_NAME = "task_name"
  private const val KEY_SECONDARY_LABEL = "secondary_label"
  private const val KEY_STARTED_AT_MS = "started_at_ms"
  private const val KEY_PAUSED_ELAPSED_MS = "paused_elapsed_ms"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun save(context: Context, taskName: String, secondaryLabel: String?, startedAtMs: Long, pausedElapsedMs: Long) {
    prefs(context).edit()
      .putBoolean(KEY_IS_RUNNING, true)
      .putString(KEY_TASK_NAME, taskName)
      .putString(KEY_SECONDARY_LABEL, secondaryLabel)
      .putLong(KEY_STARTED_AT_MS, startedAtMs)
      .putLong(KEY_PAUSED_ELAPSED_MS, pausedElapsedMs)
      .apply()
  }

  /**
   * Marks tracking stopped but deliberately leaves the other fields in
   * place — nothing reads them again until the next `save()`, and dropping
   * them here would just be extra writes for no benefit.
   */
  fun clear(context: Context) {
    prefs(context).edit().putBoolean(KEY_IS_RUNNING, false).apply()
  }

  fun read(context: Context): LiveTrackingState {
    val p = prefs(context)
    return LiveTrackingState(
      isRunning = p.getBoolean(KEY_IS_RUNNING, false),
      taskName = p.getString(KEY_TASK_NAME, null) ?: "",
      secondaryLabel = p.getString(KEY_SECONDARY_LABEL, null),
      startedAtMs = p.getLong(KEY_STARTED_AT_MS, 0L),
      pausedElapsedMs = p.getLong(KEY_PAUSED_ELAPSED_MS, 0L),
    )
  }
}
