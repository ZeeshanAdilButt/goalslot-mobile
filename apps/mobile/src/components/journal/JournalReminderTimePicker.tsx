// "What time should the journal reminder fire?" — the journal reminder's
// counterpart to src/components/timer/ReminderIntervalPicker.tsx. Same shape
// deliberately: a horizontally-scrolling row of chips rather than a native
// time-picker modal, since the reminder only ever offers a short, curated
// list of evening hours (see journal-reminders.ts's
// JOURNAL_REMINDER_HOUR_OPTIONS) — a full clock-face picker would let
// someone choose 6am for a "did you journal today" nudge, which defeats the
// point of asking the question at all.

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { JOURNAL_REMINDER_HOUR_OPTIONS } from "@/lib/journal-reminders";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface JournalReminderTimePickerProps {
  /** Currently selected hour (0-23, whole hours only). */
  value: number;
  disabled?: boolean;
  onChange: (hour: number) => void;
}

/** "8:00 PM" — matches the 12-hour, no-leading-zero convention formatTime12h uses elsewhere in this app. */
function formatHour12h(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

export function JournalReminderTimePicker({ value, disabled = false, onChange }: JournalReminderTimePickerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Icon name="timer" size={14} color={colors.mutedForeground} />
        <Text style={styles.label}>Time</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.options}
        accessibilityRole="radiogroup"
        accessibilityLabel="Journal reminder time"
      >
        {JOURNAL_REMINDER_HOUR_OPTIONS.map((hour) => {
          const selected = hour === value;
          return (
            <Pressable
              key={hour}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                disabled && styles.chipDisabled,
                pressed && !disabled && styles.chipPressed,
              ]}
              onPress={() => onChange(hour)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={formatHour12h(hour)}
              accessibilityState={{ selected, disabled }}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{formatHour12h(hour)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.caption}>Reminds you at {formatHour12h(value)} if you haven't journaled yet that day.</Text>
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
    paddingRight: spacing.xs,
  },
  chip: {
    minHeight: minTouchTarget,
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
