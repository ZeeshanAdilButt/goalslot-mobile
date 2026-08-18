// "What times should the due-today digest fire?" — the digest's counterpart
// to src/components/journal/JournalReminderTimePicker.tsx. Same visual shape
// (a horizontally-scrolling row of chips) but MULTI-select rather than
// single-select: the whole point of this feature is more than one
// configurable time per day (see task-digest-reminders.ts's header — this
// replaced a per-task reminder that fired one notification per task, all at
// once, with a single combined notification at a user-chosen SET of times).
// So each chip toggles independently (`accessibilityRole="checkbox"`, one
// per chip) rather than the journal picker's `radiogroup`/`radio` pair.

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { notify } from "@/lib/api-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Hourly from 6am to 10pm — spans the waking day without offering the middle of the night, same curation reasoning JOURNAL_REMINDER_HOUR_OPTIONS uses for its own narrower evening slice. */
export const TASK_DIGEST_HOUR_OPTIONS: readonly number[] = Array.from({ length: 17 }, (_, i) => i + 6);

export interface TaskDigestHoursPickerProps {
  /** Currently selected hours (0-23, whole hours only). */
  value: readonly number[];
  disabled?: boolean;
  onChange: (hours: number[]) => void;
}

/** "9:00 AM" — matches the 12-hour, no-leading-zero convention formatTime12h uses elsewhere in this app. */
function formatHour12h(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

export function TaskDigestHoursPicker({ value, disabled = false, onChange }: TaskDigestHoursPickerProps) {
  const selectedSet = new Set(value);

  const toggleHour = (hour: number) => {
    if (selectedSet.has(hour)) {
      // At least one time must always stay selected — a digest with zero
      // configured times is indistinguishable from the feature being off,
      // and silently no-opping here would look like the tap did nothing.
      // Same "block, don't silently no-op" idiom the rest of this app uses
      // (see notify() call sites) rather than a native Alert.alert.
      if (selectedSet.size <= 1) {
        notify("Keep at least one reminder time", "error");
        return;
      }
      onChange(value.filter((h) => h !== hour).sort((a, b) => a - b));
      return;
    }
    onChange([...value, hour].sort((a, b) => a - b));
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Icon name="timer" size={14} color={colors.mutedForeground} />
        <Text style={styles.label}>Times</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.options}
        accessibilityLabel="Due-today reminder times"
      >
        {TASK_DIGEST_HOUR_OPTIONS.map((hour) => {
          const selected = selectedSet.has(hour);
          return (
            <Pressable
              key={hour}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                disabled && styles.chipDisabled,
                pressed && !disabled && styles.chipPressed,
              ]}
              onPress={() => toggleHour(hour)}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={formatHour12h(hour)}
              accessibilityState={{ checked: selected, disabled }}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{formatHour12h(hour)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.caption}>
        {value.length === 0
          ? "Choose at least one time."
          : `Reminds you at ${value
              .slice()
              .sort((a, b) => a - b)
              .map(formatHour12h)
              .join(", ")} if you have tasks due today.`}
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
