// One active goal with its logged-vs-target progress.
//
// Port of dw-time-web's src/features/dashboard/components/dashboard-goals.tsx
// (lines 45-100): colored left rail keyed to `goal.color`, category chip,
// title, a thin track filled in brand yellow, and the percentage set in
// tabular numerals on the right. Same clamp and same rounding as web:
//   `Math.min(100, Math.round(loggedHours / targetHours * 100))`, and 0 when
//   the target is 0 so a goal with no target can't divide by zero.
//
// Why it's on Today at all: the web dashboard treats "Active Goals" as the
// largest block on the page (it spans 2 of 3 columns). Dropping it from
// mobile is a big part of why Today read as empty — the schedule and task
// lists are both genuinely empty on a fresh day, but goals usually aren't.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { Goal } from "@goalslot/shared";

import { PressableScale } from "@/components/today/PressableScale";
import { colors, radii, spacing, typography } from "@/theme/tokens";

export interface GoalProgressRowProps {
  goal: Goal;
  isLast: boolean;
  /** Opens the Goals tab. Omit to render the row as static content. */
  onPress?: () => void;
}

export const GoalProgressRow = memo(function GoalProgressRow({ goal, isLast, onPress }: GoalProgressRowProps) {
  const progress =
    goal.targetHours > 0 ? Math.min(100, Math.round((goal.loggedHours / goal.targetHours) * 100)) : 0;

  const Container = onPress ? PressableScale : View;
  // The percentage moves from `accessibilityValue` into the label when the
  // row becomes a button: VoiceOver reads a value for `progressbar`, but not
  // for `button`, so leaving it there would silently drop the number.
  const pressProps = onPress
    ? ({
        onPress,
        accessibilityRole: "button",
        accessibilityHint: "Opens your goals",
        accessibilityLabel: `${goal.title}, ${goal.category}, ${progress} percent`,
      } as const)
    : ({
        accessibilityRole: "progressbar",
        accessibilityLabel: `${goal.title}, ${goal.category}`,
        accessibilityValue: { min: 0, max: 100, now: progress, text: `${progress} percent` },
      } as const);

  return (
    <Container style={[styles.row, isLast && styles.rowLast]} accessible {...pressProps}>
      <View style={[styles.rail, { backgroundColor: goal.color }]} />

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {goal.title}
          </Text>
          <Text style={styles.percent}>{progress}%</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.categoryChip}>
            <Text style={styles.categoryText} numberOfLines={1}>
              {goal.category}
            </Text>
          </View>
          <Text style={styles.hours}>
            {Math.round(goal.loggedHours)}h of {Math.round(goal.targetHours)}h
          </Text>
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress}%` }]} />
        </View>
      </View>
    </Container>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rail: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: radii.full,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: colors.foreground,
    flexShrink: 1,
  },
  percent: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  categoryChip: {
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    flexShrink: 1,
  },
  categoryText: {
    ...typography.label,
    fontSize: 9,
    // `mutedForeground` on `secondary` is 4.40:1 — fine for the 12px body
    // copy it was borrowed from, under the 4.5:1 floor at 9px.
    color: colors.foreground,
  },
  hours: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  track: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    overflow: "hidden",
    marginTop: spacing.xxs,
  },
  fill: {
    height: "100%",
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
});
