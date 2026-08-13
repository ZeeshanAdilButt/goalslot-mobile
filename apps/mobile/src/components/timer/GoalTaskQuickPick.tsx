// The cascading half of TrackingPicker: once a goal is picked, this renders
// that goal's own tasks as a horizontally-scrolling chip row so the user
// isn't sent back into the flat, everything-search list to find a task that
// belongs to the goal they just chose.
//
// This is deliberately a QUICK-SELECT, not a replacement search surface —
// see TrackingPicker.tsx's header for why the flat list's search has to stay
// untouched (the web bug where a pre-selected category hid goals from
// search). Nothing here filters what the flat list underneath shows; it
// only adds a shortcut above it. Scoping is done by the caller (matching
// `task.goalId === goal.id` against the SAME full `tasks` array the flat
// list already has) rather than by a second fetch, so there is no new
// request and no chance of the shortcut and the list disagreeing about what
// a goal's tasks are.

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { Goal, Task } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface GoalTaskQuickPickProps {
  goal: Goal;
  /** This goal's own tasks — already filtered by the caller. */
  tasks: Task[];
  selectedTaskId?: string | null;
  onPickTask: (task: Task) => void;
}

export function GoalTaskQuickPick({ goal, tasks, selectedTaskId, onPickTask }: GoalTaskQuickPickProps) {
  if (tasks.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={[styles.goalDot, { backgroundColor: goal.color }]} />
        <Text style={styles.headerText} numberOfLines={1}>
          Tasks for “{goal.title}”
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {tasks.map((task) => {
          const selected = selectedTaskId === task.id;
          return (
            <Pressable
              key={task.id}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.chipPressed]}
              onPress={() => onPickTask(task)}
              accessibilityRole="button"
              accessibilityLabel={`Track task "${task.title}" for goal "${goal.title}"`}
              accessibilityState={{ selected }}
            >
              {selected ? (
                <Icon name="check" size={13} color={colors.primaryForeground} />
              ) : (
                <View style={[styles.chipDot, { backgroundColor: goal.color }]} />
              )}
              <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                {task.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  goalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerText: {
    ...typography.label,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  chipRow: {
    gap: spacing.sm,
    paddingRight: spacing.md,
    // Keeps a chip's press ripple/scale from clipping against the row edge.
    paddingVertical: spacing.xxs,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipSelected: {
    borderColor: colors.foreground,
    backgroundColor: colors.foreground,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    maxWidth: 160,
  },
  chipTextSelected: {
    color: colors.white,
  },
});
