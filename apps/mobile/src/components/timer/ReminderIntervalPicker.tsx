// "How often should the timer nudge me?" — the mobile face of web's REMINDER
// control (dw-time-web/src/features/time-tracker/components/timer-settings.tsx).
//
// Same seven intervals, same default, same "Every N minutes" phrasing, and
// the same locked-while-running rule web enforces with `disabled={timerState
// === 'RUNNING'}`: the choice is editable while idle or paused, fixed for the
// duration of a run. Only the control itself is native rather than ported —
// web renders a dropdown, which on a phone would put seven adjacent numbers
// behind a modal for no reason. A row of chips shows the whole range at once
// and settles the choice in one tap.
//
// Sits between TrackingTarget and TimerControls to mirror web's own ordering
// (TimerDisplay -> TaskSelector -> TimerSettings -> TimerControls), so the
// question "what am I tracking, and how often should it check in?" is
// answered before the eye reaches the transport buttons.

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { REMINDER_INTERVAL_OPTIONS } from "@/lib/timer-reminders";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface ReminderIntervalPickerProps {
  /** Currently selected interval in minutes. */
  value: number;
  /** True while a session is running — matches web, where the select is locked mid-run. */
  disabled: boolean;
  onChange: (minutes: number) => void;
}

export function ReminderIntervalPicker({ value, disabled, onChange }: ReminderIntervalPickerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        {/* `timer` is the Icon set's Clock glyph, the same one web puts in the
            select trigger; there is no bare "clock" name (see Icon.tsx). */}
        <Icon name="timer" size={14} color={colors.mutedForeground} />
        <Text style={styles.label}>Reminder</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.options}
        // Without this the group reads out as seven unrelated buttons; with
        // it, VoiceOver/TalkBack announce it as one radio group and each chip
        // as "Every 15 minutes, selected".
        accessibilityRole="radiogroup"
        accessibilityLabel="Reminder interval"
      >
        {REMINDER_INTERVAL_OPTIONS.map((minutes) => {
          const selected = minutes === value;
          return (
            <Pressable
              key={minutes}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                disabled && styles.chipDisabled,
                pressed && !disabled && styles.chipPressed,
              ]}
              onPress={() => onChange(minutes)}
              disabled={disabled}
              accessibilityRole="radio"
              // Spelled out rather than left as the visible "15m", which a
              // screen reader would otherwise pronounce as "fifteen metres".
              accessibilityLabel={`Every ${minutes} minutes`}
              accessibilityState={{ selected, disabled }}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{minutes}m</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.caption}>
        {disabled
          ? `Checking in every ${value} minutes · locked while tracking`
          : `Checks in every ${value} minutes while a timer runs`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
  },
  options: {
    flexDirection: "row",
    gap: spacing.sm,
    // The chips scroll horizontally, so the row needs its own trailing breath
    // — otherwise the last chip sits flush against the card edge at rest.
    paddingRight: spacing.xs,
  },
  chip: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
  chipSelected: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  chipLabelSelected: {
    color: colors.white,
  },
  caption: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
});
