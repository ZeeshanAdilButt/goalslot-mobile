// One "due today" task on the Today agenda.
//
// Anatomy follows dw-time-web's task rows (src/features/tasks/components/
// task-header.tsx + task-metadata.tsx): status marker, bold title, then a
// muted metadata line of "chips". The one meaningful change is the status
// marker — web leans on a colored `StatusPill` alone, while a checkbox-shaped
// marker is the universal mobile idiom for "an item with a done state" and
// gives the row a stable 24px leading column to align against.
//
// Read-only by design: Today shows the agenda, and mutating task status is
// the Tasks tab's job. The marker is therefore drawn, not pressable, and is
// hidden from assistive tech (the status is already in the row's label).

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatDuration, type Task } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { PressableScale } from "@/components/today/PressableScale";
import { colors, radii, spacing, typography } from "@/theme/tokens";

const STATUS_COPY: Record<Task["status"], string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  DOING: "In progress",
  DONE: "Done",
};

export interface TaskRowProps {
  task: Task;
  isLast: boolean;
  /** Opens the Tasks tab. Omit to render the row as static content. */
  onPress?: () => void;
}

// Memoised: the Today screen ticks once a minute and would otherwise
// re-render every task row on every tick for no reason.
export const TaskRow = memo(function TaskRow({ task, isLast, onPress }: TaskRowProps) {
  const isDoing = task.status === "DOING";
  const isDone = task.status === "DONE";
  const meta = [task.category, task.estimatedMinutes ? formatDuration(task.estimatedMinutes) : null]
    .filter(Boolean)
    .join(" · ");

  const Container = onPress ? PressableScale : View;
  const pressProps = onPress
    ? ({ onPress, accessibilityRole: "button", accessibilityHint: "Opens your tasks" } as const)
    : null;

  return (
    <Container
      style={[styles.row, isLast && styles.rowLast]}
      accessible
      accessibilityLabel={`${task.title}, ${STATUS_COPY[task.status]}${meta ? `, ${meta}` : ""}`}
      {...pressProps}
    >
      <View
        style={[styles.marker, isDone && styles.markerDone, isDoing && styles.markerDoing]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {isDone ? <Icon name="check" size={13} color={colors.successForeground} /> : null}
        {isDoing ? <View style={styles.markerPulse} /> : null}
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, isDone && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>

      <View style={[styles.pill, isDoing && styles.pillDoing]}>
        <Text style={[styles.pillText, isDoing && styles.pillTextDoing]}>{STATUS_COPY[task.status]}</Text>
      </View>
    </Container>
  );
});

const MARKER_SIZE = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // 44pt is the Apple HIG / Material floor for a comfortable target; rows
    // aren't tappable yet but keeping the rhythm means they can become so
    // without the list visibly reflowing.
    minHeight: 56,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  markerDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  // "In progress" is the app's brand-accent moment (same as the timeline's
  // "Now" pill), not a warning. It was drawn in `warning` (#F59F0A), which
  // is also a contrast failure: #F59F0A on `warningMuted` measures 1.94:1
  // and on white 2.13:1 — under the 4.5:1 floor for the 9px pill text and
  // under the 3:1 floor for the marker ring. `primaryText` (#A16207) clears
  // both (4.8:1 on the tint, 4.9:1 on white).
  markerDoing: {
    borderColor: colors.primaryText,
    backgroundColor: colors.primaryMuted,
  },
  markerPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryText,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    lineHeight: 19,
    color: colors.foreground,
  },
  titleDone: {
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  meta: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  pill: {
    flexShrink: 0,
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillDoing: {
    backgroundColor: colors.primaryMuted,
  },
  pillText: {
    ...typography.label,
    fontSize: 9,
    color: colors.mutedForeground,
  },
  pillTextDoing: {
    color: colors.primaryText,
  },
});
