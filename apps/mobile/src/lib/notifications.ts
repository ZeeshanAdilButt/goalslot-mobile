// Real implementation of the shared package's NotificationCapability, built
// on expo-notifications (~57.0.9). This is the only file in the app that
// imports expo-notifications directly — everything else goes through
// useCapabilities().notifications per the capability-boundary pattern
// (dw-time-mobile/DECISIONS.md).
//
// Permission handling: `scheduleNotification` never throws on missing
// permission. It checks the current status and, if not yet granted and the
// user can still be asked, requests it inline (there's no separate
// notifications-onboarding screen yet, so the first schedule call doubles
// as the permission prompt). If the user has already denied and can't be
// asked again, scheduling silently no-ops with a console warning — the
// interface's contract is that callers can always await scheduleNotification
// without a try/catch, the same way createNoopNotificationCapability behaves.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import type { NotificationCapability, NotificationInput } from "@goalslot/shared";

/**
 * Android channel for alarm-grade reminders (`NotificationInput.alarm`).
 *
 * Separate from the timer's `goalslot-timer` channel, and deliberately the
 * opposite of it: that one is IMPORTANCE_LOW precisely so re-presenting the
 * ongoing entry never re-alerts, this one is MAX so a schedule block's start
 * actually peeks, sounds and vibrates.
 *
 * A channel's importance and sound are FROZEN at creation on Android 8+ —
 * `setNotificationChannelAsync` on an existing id can update the name but the
 * OS ignores importance/sound changes, by design, so an app can't quietly
 * re-escalate something a user turned down. The id therefore carries a
 * version suffix: shipping a channel with the wrong importance once would
 * otherwise be permanent for every existing install. Bump the suffix if these
 * settings ever need to change again.
 */
const ALARM_CHANNEL_ID = "goalslot-schedule-alarms-v1";

/** Long-short-long — reads as an alert rather than the single buzz of a notice. */
const ALARM_VIBRATION_PATTERN = [0, 400, 200, 400];

/**
 * Created lazily and remembered, because this runs on every single
 * `scheduleNotification` call and a week of blocks is dozens of them. The
 * promise (not a boolean) is cached so concurrent callers share one in-flight
 * creation rather than racing.
 */
let alarmChannelReady: Promise<void> | null = null;

async function ensureAlarmChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  alarmChannelReady ??= Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: "Schedule alarms",
    description: "Alerts when one of your scheduled time slots begins.",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: ALARM_VIBRATION_PATTERN,
    enableVibrate: true,
    // Show the block's title on the lock screen — this is the surface the
    // alert is most likely to be read on, and a hidden one is useless.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  }).then(() => undefined);
  await alarmChannelReady;
}

/** Test seam only — lets a suite assert the channel is (re)created. */
export function resetAlarmChannelCacheForTests(): void {
  alarmChannelReady = null;
}

export function createExpoNotificationCapability(): NotificationCapability {
  return {
    async getPermissionStatus() {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return "granted";
      // `canAskAgain` is the distinction that matters, not expo's `status`
      // string. On iOS `status` is 'undetermined' only before the very first
      // prompt; after a decline it is 'denied' and the system will never
      // show the prompt again, so the app has to send the user to the
      // Settings app instead of offering a button that no-ops.
      return current.canAskAgain ? "undetermined" : "denied";
    },

    async requestPermission() {
      const response = await Notifications.requestPermissionsAsync();
      return response.granted;
    },

    async scheduleNotification(input: NotificationInput) {
      const { id, title, body, data, alarm = false } = input;
      const current = await Notifications.getPermissionsAsync();
      let granted = current.granted;

      if (!granted && current.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.granted;
      }

      if (!granted) {
        console.warn(`[notifications] permission not granted, skipping scheduleNotification(${id})`);
        return;
      }

      if (alarm) await ensureAlarmChannel();

      // expo-notifications' WeeklyTriggerInput numbers weekdays 1-7 with
      // Sunday = 1; NotificationInput's `repeat.weekday` follows
      // ScheduleBlock's own 0-6/Sunday=0 convention so the shared package
      // never has to know an expo-specific numbering — the +1 conversion
      // belongs here, at the one file allowed to import expo-notifications.
      //
      // `channelId` has to ride on the TRIGGER, not the content — that is
      // where expo-notifications reads it from. Without it an alarm lands on
      // the library's `expo_notifications_fallback_notification_channel`,
      // whose settings this app does not control.
      const androidChannel = alarm && Platform.OS === "android" ? { channelId: ALARM_CHANNEL_ID } : null;
      const trigger = input.repeat
        ? {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY as const,
            weekday: input.repeat.weekday + 1,
            hour: input.repeat.hour,
            minute: input.repeat.minute,
            ...androidChannel,
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE as const,
            date: new Date(input.fireAtUtc),
            ...androidChannel,
          };

      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title,
          body,
          // `data` is what src/lib/deep-links.ts reads back on tap to decide
          // which screen to open — without it a tap can only cold-open the app.
          data,
          // THE bug behind "alarms not working": with no `sound` key at all,
          // expo-notifications' Android builder takes the
          // `!shouldPlaySound && !shouldVibrate` branch and calls
          // `builder.setSilent(true)`, which suppresses sound AND heads-up
          // REGARDLESS of how important the channel is; on iOS a content
          // without `sound` is delivered as a silent banner. So the previous
          // code produced a notification that was, on both platforms, a
          // wordless entry in the shade — visually present, never noticed.
          ...(alarm
            ? {
                sound: "default" as const,
                vibrate: ALARM_VIBRATION_PATTERN,
                priority: Notifications.AndroidNotificationPriority.MAX,
                // iOS 15+: the only interruption level that penetrates a
                // Focus mode without the Critical Alerts entitlement (which
                // requires a special request to Apple). "A scheduled block is
                // starting now" is exactly the time-sensitive case.
                interruptionLevel: "timeSensitive" as const,
              }
            : {}),
        },
        trigger,
      });
    },

    async cancelNotification(id: string) {
      await Notifications.cancelScheduledNotificationAsync(id);
    },

    async listScheduledIds() {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        return scheduled.map((request) => request.identifier);
      } catch (error) {
        // Callers prune against this list. Reporting "nothing is queued"
        // would be a lie that causes no harm (a prune finds no orphans and
        // leaves the queue alone), whereas throwing would abort the
        // reconcile pass that arms the real alarms.
        console.warn("[notifications] could not list scheduled notifications", error);
        return [];
      }
    },

    async clearAllNotifications() {
      // A per-account notification can sit in either of two queues, and this
      // has to empty both:
      //
      //   - PENDING, not yet fired. Schedule-block reminders (weekly, titled
      //     with the block's own name) and the timer's "Time Check" batch.
      //     `cancelAllScheduledNotificationsAsync` is what drops these.
      //   - DELIVERED, already in the shade. The ongoing "Tracking · <task>"
      //     entry from components/timer/useTimerNotification.ts, which is
      //     presented immediately and so is never "scheduled" by the time a
      //     sign-out runs. Cancelling a pending notification does nothing to
      //     an entry that has already been posted — that needs
      //     `dismissAllNotificationsAsync`.
      //
      // Neither call needs notification permission: revoking permission stops
      // notifications being shown, it doesn't retroactively clear what was
      // already accepted, so this still has work to do for a user who granted
      // permission once and later turned it off.
      //
      // The two are guarded separately and never rethrow. This is called from
      // the sign-out path, where the whole point is that the previous
      // account's reminders stop — a failure in one queue must not skip the
      // other, and neither may block the sign-out itself.
      await clear("scheduled", () => Notifications.cancelAllScheduledNotificationsAsync());
      await clear("delivered", () => Notifications.dismissAllNotificationsAsync());
    },
  };
}

async function clear(queue: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn(`[notifications] could not clear ${queue} notifications`, error);
  }
}
