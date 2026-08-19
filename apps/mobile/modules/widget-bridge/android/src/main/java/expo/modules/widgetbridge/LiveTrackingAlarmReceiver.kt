package expo.modules.widgetbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fires on three occasions, all handled identically:
 *  1. The recurring 60s tick LiveTrackingScheduler schedules with
 *     AlarmManager while a session is running.
 *  2. BOOT_COMPLETED — AlarmManager alarms do not survive a reboot, so a
 *     session that was running when the phone restarted would otherwise
 *     freeze forever (until the next `syncWidgets()` JS call happens to
 *     fire) instead of resuming its native tick.
 *  3. MY_PACKAGE_REPLACED — some OEMs also clear pending alarms across an
 *     app update; same recovery.
 *
 * `redrawAndReschedule` itself re-reads LiveTrackingStore and is a no-op if
 * a session isn't actually running any more (e.g. this alarm fired in the
 * brief window right after `stop()` already cancelled it, or after a reboot
 * with nothing running) — so no separate handling per action is needed.
 */
class LiveTrackingAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    LiveTrackingScheduler.redrawAndReschedule(context)
  }
}
