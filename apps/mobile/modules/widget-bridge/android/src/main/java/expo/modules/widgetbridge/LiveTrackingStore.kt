package expo.modules.widgetbridge

import android.content.Context
import android.content.SharedPreferences

/**
 * The one bit of state the native alarm receiver needs: is a timer session
 * still running? Everything the widget actually DISPLAYS is resolved by
 * react-native-android-widget's own headless JS render (widget-data.ts), so
 * this deliberately stores nothing about the session itself — no labels, no
 * start timestamp. An earlier version persisted all of that to draw a native
 * card from it; see LiveTrackingScheduler's header for why that approach was
 * removed.
 *
 * Plain SharedPreferences rather than the app's AsyncStorage/SecureStore
 * (both JS-side abstractions this native-only path deliberately avoids): the
 * only requirement is surviving process death, which SharedPreferences
 * already does.
 */
internal object LiveTrackingStore {
  private const val PREFS_NAME = "expo.modules.widgetbridge.live_tracking"
  private const val KEY_IS_RUNNING = "is_running"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun setRunning(context: Context, running: Boolean) {
    prefs(context).edit().putBoolean(KEY_IS_RUNNING, running).apply()
  }

  fun isRunning(context: Context): Boolean = prefs(context).getBoolean(KEY_IS_RUNNING, false)
}
