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
 * OS ignores importance/sound/audioAttributes changes, by design, so an app
 * can't quietly re-escalate something a user turned down. The id therefore
 * carries a version suffix: shipping a channel with the wrong importance
 * once would otherwise be permanent for every existing install. Bump the
 * suffix if these settings ever need to change again.
 *
 * v2 bump reason: v1 had no `audioAttributes`, so Android played it over the
 * standard notification/ringer stream — a phone with ringer volume turned
 * down (but Alarm volume up) got a silent "alarm". `ensureAlarmChannel` now
 * sets `audioAttributes.usage: ALARM`, which puts this channel's sound on
 * `STREAM_ALARM`, governed by the device's separate Alarm volume slider,
 * same as the OS clock app. Because that attribute is frozen at creation
 * too, existing installs would keep using the old v1 channel's notification
 * stream forever without this id bump — v1 is intentionally abandoned, not
 * deleted (same pattern as the schedule/notify channel history above).
 */
const ALARM_CHANNEL_ID = "goalslot-schedule-alarms-v2";

/**
 * Android channel for the gentler "notify" tier (`NotificationInput.notify`).
 *
 * A separate id from `ALARM_CHANNEL_ID`, not a shared one, for the same
 * reason that comment gives: a channel's importance and sound are FROZEN at
 * creation on Android 8+, so this tier needs its own id to ever land at
 * DEFAULT importance rather than inheriting whatever the alarm channel
 * already locked in. Bump the suffix if these settings ever need to change.
 */
const NOTIFY_CHANNEL_ID = "goalslot-schedule-notify-v1";

/** Long-short-long — reads as an alert rather than the single buzz of a notice. */
const ALARM_VIBRATION_PATTERN = [0, 400, 200, 400];

/**
 * Created lazily and remembered, because this runs on every single
 * `scheduleNotification` call and a week of blocks is dozens of them. The
 * promise (not a boolean) is cached so concurrent callers share one in-flight
 * creation rather than racing.
 */
let alarmChannelReady: Promise<void> | null = null;
/** Same caching rationale as `alarmChannelReady`, for the "notify" tier's own channel. */
let notifyChannelReady: Promise<void> | null = null;

async function ensureAlarmChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  alarmChannelReady ??= Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: "Schedule alarms",
    description: "Alerts when one of your scheduled time slots begins.",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    // THE fix for "alarms don't sound when media/ringer volume is low":
    // without this, the channel's sound plays over Android's default
    // notification audio stream, which shares the ringer/notification volume
    // slider — not the separate Alarm volume slider the user expects an
    // "alarm" to respect. `usage: ALARM` puts it on STREAM_ALARM instead,
    // same as the OS clock app, so it stays audible regardless of ringer
    // volume. `contentType: SONIFICATION` is the attribute Android's own
    // alarm/notification sounds use (as opposed to SPEECH/MUSIC/MOVIE).
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
    vibrationPattern: ALARM_VIBRATION_PATTERN,
    enableVibrate: true,
    // Show the block's title on the lock screen — this is the surface the
    // alert is most likely to be read on, and a hidden one is useless.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  }).then(() => undefined);
  await alarmChannelReady;
}

/**
 * Deliberately DEFAULT importance, no custom vibration pattern, and no
 * MAX/HIGH priority anywhere this channel is used — see NotificationInput.notify's
 * doc comment. This is the tier that stays audible without being the loud,
 * DND-piercing alarm.
 */
/**
 * Exported (unlike `ensureAlarmChannel`) so app startup can create this
 * channel eagerly instead of only lazily the first time a local "notify"
 * tier reminder schedules. Server-sent push (see goal-slot-api's
 * notification-policy.ts ANDROID_NOTIFY_CHANNEL_ID) always targets this
 * exact channel id, and FCM silently drops any notification referencing a
 * channel id Android hasn't seen `createNotificationChannel` for yet — so an
 * install that has never set a schedule block to the "Notify" tier locally
 * would otherwise never receive a single server push (message, instruction
 * assigned, shared-report-unviewed, app-release) with no error on either
 * side. See app/_layout.tsx's call site.
 */
export async function ensureNotifyChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  notifyChannelReady ??= Notifications.setNotificationChannelAsync(NOTIFY_CHANNEL_ID, {
    name: "Schedule notifications",
    description: "A quieter heads-up when one of your scheduled time slots begins.",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  }).then(() => undefined);
  await notifyChannelReady;
}

/** Test seam only — lets a suite assert the channels are (re)created. */
export function resetAlarmChannelCacheForTests(): void {
  alarmChannelReady = null;
  notifyChannelReady = null;
}

// ---------------------------------------------------------------------------
// Remote push (as opposed to everything above, which is LOCAL notifications
// this app schedules on the device itself)
// ---------------------------------------------------------------------------

/**
 * Acquires this device's Expo push token — the address the API's Expo channel
 * (goal-slot-api/src/modules/reminders/channels/expo-push-channel.provider.ts)
 * sends to. Lives in this file rather than alongside the registration logic
 * because this is the file allowed to import expo-notifications; the
 * orchestration around it (when to fetch, dedupe, POST, withdraw) is in
 * src/lib/push-registration.ts and is a pure function over this one.
 *
 * Returns null rather than throwing, on purpose — every documented failure
 * here is a normal, non-exceptional state that must not break app start:
 *
 *   - a simulator/emulator has no push capability at all;
 *   - the call reaches out to Expo's servers, so it fails when offline;
 *   - a build with no push credentials provisioned (notably any iOS build
 *     signed with a free/personal Apple account, which cannot carry the
 *     Push Notifications capability) is rejected outright.
 *
 * The caller retries on the next launch; there is nothing a user could do
 * about any of these in the moment, so none of them warrant an error UI.
 */
export async function getExpoPushToken(projectId: string): Promise<string | null> {
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return typeof token?.data === "string" && token.data.length > 0 ? token.data : null;
  } catch (error) {
    console.warn("[notifications] could not acquire an Expo push token", error);
    return null;
  }
}

/**
 * Subscribes to push-token rotation. The push service can roll a token while
 * the app is running, at which point the old one silently stops delivering —
 * so re-registering promptly is the difference between "messages stopped
 * arriving for no reason" and a self-healing registration.
 *
 * The listener is handed the DEVICE token, which is not what the API stores;
 * callers re-run the full registration sync (which re-reads the Expo token)
 * rather than trying to use the value passed in. Returns an unsubscribe
 * function so React callers can clean up on unmount.
 */
export function addPushTokenChangeListener(onChange: () => void): () => void {
  const subscription = Notifications.addPushTokenListener(() => onChange());
  return () => subscription.remove();
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
      const { id, title, body, data, alarm = false, notify = false } = input;
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
      else if (notify) await ensureNotifyChannel();

      // expo-notifications' WeeklyTriggerInput numbers weekdays 1-7 with
      // Sunday = 1; NotificationInput's `repeat.weekday` follows
      // ScheduleBlock's own 0-6/Sunday=0 convention so the shared package
      // never has to know an expo-specific numbering — the +1 conversion
      // belongs here, at the one file allowed to import expo-notifications.
      //
      // `channelId` has to ride on the TRIGGER, not the content — that is
      // where expo-notifications reads it from. Without it a reminder lands
      // on the library's `expo_notifications_fallback_notification_channel`,
      // whose settings this app does not control.
      const channelId = alarm ? ALARM_CHANNEL_ID : notify ? NOTIFY_CHANNEL_ID : null;
      const androidChannel = channelId && Platform.OS === "android" ? { channelId } : null;
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
          // "notify" is not exempt from this: it must stay audible, just not
          // alarm-grade, so it still needs an explicit `sound` — omitting it
          // here would reintroduce the exact same silent-banner bug for this
          // tier alone.
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
            : notify
              ? {
                  // Audible and visible, deliberately NOT alarm-grade: no
                  // custom vibration pattern (system default applies), no
                  // MAX/HIGH priority, and no `interruptionLevel` — "notify"
                  // must not bypass a Focus/DND profile the way "alarm" does.
                  sound: "default" as const,
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
