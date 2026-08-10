// Bottom sheet for picking what the next run is tracked against.
//
// Rows rather than the wrap of pills this replaces: pills truncate real task
// titles badly at phone width and give nowhere to put the parent goal, and a
// full-width row is a far easier target than a half-width chip. Still
// deliberately not a searchable combobox — one tap to pick is right for the
// list sizes this app deals with; search is a v2 concern if lists grow.
//
// Selection semantics are unchanged: picking a task clears any picked goal
// and vice versa (see timer.tsx's handlers), because a run is tracked
// against one or the other, never both.

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { Goal, Task } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface TrackingPickerProps {
  visible: boolean;
  tasks: Task[];
  goals: Goal[];
  /** Currently picked id (task or goal), so the sheet can show what's selected. */
  selectedId?: string | null;
  onPickTask: (task: Task) => void;
  onPickGoal: (goal: Goal) => void;
  onClose: () => void;
}

export function TrackingPicker({
  visible,
  tasks,
  goals,
  selectedId,
  onPickTask,
  onPickGoal,
  onClose,
}: TrackingPickerProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close picker">
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>What are you tracking?</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <SectionLabel text="Tasks" count={tasks.length} />
            {tasks.length === 0 ? (
              <Text style={styles.empty}>No tasks yet</Text>
            ) : (
              tasks.map((task) => (
                <PickerRow
                  key={task.id}
                  title={task.title}
                  subtitle={task.goal?.title ?? null}
                  accentColor={task.goal?.color ?? null}
                  selected={selectedId === task.id}
                  accessibilityLabel={`Track task "${task.title}"`}
                  onPress={() => onPickTask(task)}
                />
              ))
            )}

            <SectionLabel text="Goals" count={goals.length} />
            {goals.length === 0 ? (
              <Text style={styles.empty}>No goals yet</Text>
            ) : (
              goals.map((goal) => (
                <PickerRow
                  key={goal.id}
                  title={goal.title}
                  subtitle={goal.category || null}
                  accentColor={goal.color}
                  selected={selectedId === goal.id}
                  accessibilityLabel={`Track goal "${goal.title}"`}
                  onPress={() => onPickGoal(goal)}
                />
              ))
            )}
          </ScrollView>

          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SectionLabel({ text, count }: { text: string; count: number }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{text}</Text>
      {count > 0 ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

interface PickerRowProps {
  title: string;
  subtitle: string | null;
  accentColor: string | null;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}

function PickerRow({ title, subtitle, accentColor, selected, accessibilityLabel, onPress }: PickerRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
    >
      <View style={[styles.rowDot, { backgroundColor: accentColor ?? colors.border }]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={18} color={colors.foreground} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  sectionCount: {
    ...typography.label,
    color: colors.mutedForeground,
    opacity: 0.7,
  },
  empty: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowSelected: {
    borderColor: colors.foreground,
    backgroundColor: colors.secondary,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  closeButton: {
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
});
