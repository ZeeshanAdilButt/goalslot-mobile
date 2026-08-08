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
import * as Notifications from "expo-notifications";

import type { NotificationCapability, NotificationInput } from "@goalslot/shared";

export function createExpoNotificationCapability(): NotificationCapability {
  return {
    async requestPermission() {
      const response = await Notifications.requestPermissionsAsync();
      return response.granted;
    },

    async scheduleNotification({ id, title, body, fireAtUtc, data }: NotificationInput) {
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

      await Notifications.scheduleNotificationAsync({
        identifier: id,
        // `data` is what src/lib/deep-links.ts reads back on tap to decide
        // which screen to open — without it a tap can only cold-open the app.
        content: { title, body, data },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAtUtc),
        },
      });
    },

    async cancelNotification(id: string) {
      await Notifications.cancelScheduledNotificationAsync(id);
    },
  };
}
