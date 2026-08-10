// "What am I timing?" — the row directly under the ring.
//
// Two states in one component so the hero card's height never changes
// between them (a jumping card under the controls is what makes a timer
// screen feel unstable):
//   - nothing picked yet: a dashed CTA that reads as an empty slot to fill,
//     which is the screen's real empty state — the ring is at zero and this
//     is the one thing the user is meant to press.
//   - something picked: a filled row carrying the goal's own colour as a
//     left rail plus a dot, the same way goal colour is used as an
//     identifying accent on rows elsewhere in the app (see the recent-entry
//     rows below it, and dw-time-web's task-selector.tsx).
//
// While a session is running the row is locked (not pressable): the store's
// taskId/goalId is fixed for the life of a run, so offering "Change" there
// would imply a re-target the timer doesn't support.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface TrackingTargetProps {
  /** Task or goal title, or null when nothing has been picked yet. */
  label: string | null;
  /** Secondary line — the parent goal, or the kind of thing this is. */
  sublabel?: string | null;
  /** Goal colour, used as the identifying accent. Null falls back to neutral. */
  accentColor?: string | null;
  /** False while a session is running/paused — the target is fixed for the run. */
  editable: boolean;
  onPress: () => void;
}

export function TrackingTarget({ label, sublabel, accentColor, editable, onPress }: TrackingTargetProps) {
  if (label === null) {
    return (
      <Pressable
        style={({ pressed }) => [styles.emptySlot, pressed && styles.pressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Choose a task or goal to track"
      >
        <View style={styles.emptyGlyph}>
          <Icon name="add" size={18} color={colors.mutedForeground} />
        </View>
        <View style={styles.body}>
          <Text style={styles.emptyTitle}>Choose what to track</Text>
          <Text style={styles.emptySubtitle} numberOfLines={1}>
            Pick a task or goal to start the clock
          </Text>
        </View>
        <Icon name="chevron" size={18} color={colors.mutedForeground} />
      </Pressable>
    );
  }

  const accent = accentColor ?? colors.mutedForeground;

  const content = (
    <>
      <View style={[styles.rail, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <View style={styles.sublabelRow}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.sublabel} numberOfLines={1}>
              {sublabel}
            </Text>
          </View>
        ) : null}
      </View>
      {editable ? (
        <View style={styles.changeAffordance}>
          <Text style={styles.changeText}>Change</Text>
          <Icon name="chevron" size={14} color={colors.mutedForeground} />
        </View>
      ) : null}
    </>
  );

  if (!editable) {
    return (
      <View style={styles.filledSlot} accessible accessibilityLabel={`Tracking ${label}`}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.filledSlot, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Tracking ${label}. Change task or goal`}
    >
      {content}
    </Pressable>
  );
}

const slotBase = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: spacing.md,
  width: "100%" as const,
  minHeight: minTouchTarget + spacing.md,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: radii.lg,
};

const styles = StyleSheet.create({
  emptySlot: {
    ...slotBase,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  filledSlot: {
    ...slotBase,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingLeft: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  rail: {
    width: 4,
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    borderRadius: radii.full,
  },
  emptyGlyph: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  sublabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sublabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  emptySubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  changeAffordance: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  changeText: {
    ...typography.label,
    color: colors.mutedForeground,
  },
});
