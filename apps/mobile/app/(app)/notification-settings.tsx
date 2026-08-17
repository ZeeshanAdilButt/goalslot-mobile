// Notification preferences: one screen for OS permission plus all three
// notification systems the app has — schedule-block alarms, the running
// timer's check-in nudges, and the once-daily journal reminder.
//
// Reached from Settings' "Notifications" row (app/(app)/settings.tsx). That
// row used to go dead the moment permission was granted: its onPress was
// `permission === "granted" ? undefined : requestOrOpenSettings`, so once a
// user actually said yes to notifications the row rendered with no chevron
// and no handler at all — tappable-looking, permanently inert. "I cannot go
// and select notifications" is exactly that: there was nowhere left for the
// row to send you. This screen is that destination, and the Settings row now
// always pushes here once permission is settled instead of dead-ending.
//
// The first two sections below are not new state — both controls already
// existed, just scattered where a user landing on "Notifications" from
// Settings would never think to look:
//   - schedule alarms   the master switch already lived as a bell icon in
//                        schedule.tsx's header (per-block/series control is
//                        one level down, in BlockDetailSheet). This reads
//                        and writes the exact same store, not a second copy.
//   - timer nudges       the interval already lived on the Timer screen via
//                         ReminderIntervalPicker + settings-store. Reused
//                         as-is, same component, same store.
// The "Journal reminder" section below them IS new state (settings-store's
// journalReminderEnabled/journalReminderHour), and this screen is one of the
// two places (with app/(app)/journal.tsx) that mounts
// useJournalReminderSync() to reconcile it — see that hook's header comment
// for why it is self-contained rather than a single app-wide sync component.
//
// The schedule-alarms switch writes straight to useScheduleRemindersStore
// rather than going through useScheduleReminders(blocks): arming/cancelling
// the actual OS-level alarms is already the job of ScheduleRemindersSync,
// mounted once for the whole authenticated app (app/(app)/_layout.tsx) and
// reacting to this exact store's fields. A second reconciler here would just
// be a second place that can fall out of sync with the first. The journal
// reminder has no such app-wide reconciler to defer to (see this screen's
// note above), so its switch below writes to settings-store directly and
// leaves the mounted useJournalReminderSync() to notice the change and act
// on it — same pattern the picker underneath it already uses for the timer.

import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import type { NotificationPermissionStatus } from "@goalslot/shared";

import { ScreenHeader } from "@/components/lists";
import { useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";
import { JournalReminderTimePicker } from "@/components/journal/JournalReminderTimePicker";
import { SettingsRow, SettingsSection } from "@/components/settings";
import { ReminderIntervalPicker } from "@/components/timer/ReminderIntervalPicker";
import { useScreenView } from "@/hooks/useScreenView";
import { openBatteryOptimizationSettings } from "@/lib/battery-optimization";
import { useScheduleRemindersStore } from "@/lib/schedule-reminders-store";
import { useSettingsStore } from "@/lib/settings-store";
import { useTimerStore } from "@/lib/timer-store";
import { createPushRegistrationPort, syncPushRegistration } from "@/lib/push-registration";
import { useJournalReminderSync } from "@/lib/useJournalReminders";
import { useAuth } from "@/providers/auth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors, radii, spacing, typography } from "@/theme/tokens";

export default function NotificationSettingsScreen() {
  const { notifications } = useCapabilities();

  // Reconciles the journal reminder against today's entry and the toggle
  // below the moment either changes while this screen is open — the other
  // mount point is app/(app)/journal.tsx. See useJournalReminderSync's
  // header comment for why there are two rather than one app-wide mount.
  useJournalReminderSync();

  const [permission, setPermission] = useState<NotificationPermissionStatus | null>(null);

  useScreenView("notificationSettings");

  // Same re-read-on-focus rule the old Settings row used: granting
  // permission means leaving for the OS settings app and coming back, and
  // this screen has to be right when that happens.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void notifications.getPermissionStatus().then((status) => {
        if (!cancelled) setPermission(status);
      });
      return () => {
        cancelled = true;
      };
    }, [notifications]),
  );

  // This route is a hidden Tabs.Screen (see the note in app/(app)/_layout.tsx),
  // not a pushed stack entry, so the OS back gesture/button doesn't reliably
  // return to Settings — it was landing on the Today dashboard instead.
  // Same fix note/[id].tsx already uses for the identical problem: intercept
  // hardware back and navigate to the known correct destination explicitly.
  // Settings is the documented, primary way to reach this screen; a second,
  // undocumented entry exists from Schedule's reminder-permission prompt,
  // which this can't distinguish from here — accepted limitation of a
  // single-destination fix rather than a full navigation-stack rework.
  useHiddenTabBackHandler(hiddenTabBackDestination("notification-settings"));

  // Remote push needs a device token, and a token can only be minted once
  // permission exists — so the moment permission becomes "granted", register
  // with the API rather than waiting for the next cold start. Keyed on
  // `permission` so it covers both routes to a grant: the in-app prompt
  // below, and the user leaving for the OS settings app and coming back
  // (which the focus effect above re-reads). Re-running is harmless — the
  // sync is idempotent and short-circuits to "unchanged" — and the effect
  // only fires when the value actually changes, not on every focus.
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (permission !== "granted" || !userId) return;
    void syncPushRegistration(userId, createPushRegistrationPort());
  }, [permission, userId]);

  const handlePermissionPress = useCallback(async () => {
    if (permission === "granted") return;
    if (permission === "denied") {
      // iOS only ever shows the system prompt once. After a decline the only
      // way back is the device's own settings.
      await Linking.openSettings();
      return;
    }
    const granted = await notifications.requestPermission();
    setPermission(granted ? "granted" : await notifications.getPermissionStatus());
  }, [notifications, permission]);

  // Android only — see battery-optimization.ts for why this row exists at
  // all: OS-level exact-alarm scheduling (the fix in notifications.ts) can
  // still be silently deferred by the phone's own battery manager, and
  // there's no permission-status API to reflect that in `value`/`description`
  // the way the row above does, so this is deliberately just an action, not
  // a state readout.
  const handleBatteryOptimizationPress = useCallback(() => {
    void openBatteryOptimizationSettings();
  }, []);

  const permissionValue =
    permission === "granted" ? "On" : permission === "denied" ? "Blocked" : permission ? "Off" : "—";
  const permissionDescription =
    permission === "granted"
      ? "GoalSlot can notify you on this device."
      : permission === "denied"
        ? "Turned off in your device settings. Tap to open them."
        : "Tap to allow schedule alarms and timer nudges.";

  // This switch only distinguishes "off" from "not off" — the tri-state
  // choice between a quiet "notify" and a loud "alarm" is set per block/series
  // from that block's own detail sheet (BlockDetailSheet.tsx), same as the
  // footnote below already says. Turning this switch back on restores
  // "alarm", matching the store's own default-on rationale (see
  // schedule-reminders-store.ts's header comment).
  const masterTier = useScheduleRemindersStore((s) => s.masterTier);
  const setMasterTier = useScheduleRemindersStore((s) => s.setMasterTier);
  const masterEnabled = masterTier !== "off";
  const setMasterEnabled = useCallback(
    (enabled: boolean) => setMasterTier(enabled ? "alarm" : "off"),
    [setMasterTier],
  );

  const reminderIntervalMinutes = useSettingsStore((s) => s.timerReminderIntervalMinutes);
  const setReminderIntervalMinutes = useSettingsStore((s) => s.setTimerReminderIntervalMinutes);
  // The picker locks mid-run on the Timer screen too (see
  // ReminderIntervalPicker's own header comment); the local store's status is
  // an approximation of "is a session live" — same one GlobalTrackingBanner
  // reads app-wide for the same purpose — good enough for a settings screen
  // that isn't itself the timer's source of truth.
  const timerRunning = useTimerStore((s) => s.status === "running");

  const journalReminderEnabled = useSettingsStore((s) => s.journalReminderEnabled);
  const setJournalReminderEnabled = useSettingsStore((s) => s.setJournalReminderEnabled);
  const journalReminderHour = useSettingsStore((s) => s.journalReminderHour);
  const setJournalReminderHour = useSettingsStore((s) => s.setJournalReminderHour);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Pressable
          onPress={() => router.replace("/settings")}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
        >
          <Text style={styles.backButtonText}>‹ Settings</Text>
        </Pressable>
        <ScreenHeader
          eyebrow="Notifications"
          title="Notifications"
          subtitle="Permission, schedule alarms and timer nudges."
        />

        <SettingsSection title="Permission">
          <SettingsRow
            label="Allow notifications"
            icon={permission === "granted" ? "bell" : "bell-off"}
            value={permissionValue}
            description={permissionDescription}
            onPress={permission === "granted" ? undefined : () => void handlePermissionPress()}
            accessibilityHint={
              permission === "denied" ? "Opens your device settings for this app" : undefined
            }
            divider={false}
          />
        </SettingsSection>

        {Platform.OS === "android" ? (
          <SettingsSection
            title="Background activity"
            footnote="Samsung and other Android phones can silently delay or skip a scheduled alarm to save battery, even with permission granted above. Exempting GoalSlot here is what makes the times below actually reliable."
          >
            <SettingsRow
              label="Battery optimization"
              icon="battery"
              description="Allow GoalSlot to run unrestricted so schedule alarms fire on time."
              onPress={handleBatteryOptimizationPress}
              divider={false}
            />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Schedule alarms"
          footnote="Silence a single day or a whole series from that block's own details on the Schedule screen."
        >
          <SettingsRow
            label="All schedule alarms"
            icon={masterEnabled ? "bell" : "bell-off"}
            description={
              masterEnabled
                ? "Every scheduled block rings when it starts."
                : "Silenced — no schedule block will alert you, including ones you add later."
            }
            accessory={
              <Switch
                value={masterEnabled}
                onValueChange={(value) => setMasterEnabled(value)}
                accessibilityRole="switch"
                accessibilityLabel="All schedule alarms"
                accessibilityState={{ checked: masterEnabled }}
              />
            }
            divider={false}
          />
        </SettingsSection>

        <SettingsSection
          title="Timer nudges"
          footnote={
            timerRunning
              ? "Locked while a timer is running."
              : "How often the running timer checks in while you're actively tracking."
          }
        >
          <View style={styles.pickerCard}>
            <ReminderIntervalPicker
              value={reminderIntervalMinutes}
              disabled={timerRunning}
              onChange={setReminderIntervalMinutes}
            />
          </View>
        </SettingsSection>

        <SettingsSection
          title="Journal reminder"
          footnote="Skips itself automatically on any day you've already written an entry."
        >
          <SettingsRow
            label="Remind me to journal"
            icon={journalReminderEnabled ? "bell" : "bell-off"}
            description={
              journalReminderEnabled
                ? "A once-daily nudge if you haven't written today's entry yet."
                : "Off — the journal won't remind you to write."
            }
            accessory={
              <Switch
                value={journalReminderEnabled}
                onValueChange={(value) => setJournalReminderEnabled(value)}
                accessibilityRole="switch"
                accessibilityLabel="Remind me to journal"
                accessibilityState={{ checked: journalReminderEnabled }}
              />
            }
            divider={journalReminderEnabled}
          />
          {journalReminderEnabled ? (
            <View style={styles.pickerCard}>
              <JournalReminderTimePicker value={journalReminderHour} onChange={setJournalReminderHour} />
            </View>
          ) : null}
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.control,
  },
  backButtonPressed: {
    backgroundColor: colors.secondary,
  },
  backButtonText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  pickerCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
