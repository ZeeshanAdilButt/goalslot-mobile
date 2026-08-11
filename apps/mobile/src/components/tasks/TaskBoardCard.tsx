// One card in a board column.
//
// Mirrors dw-time-web/src/features/tasks/components/task-board.tsx's
// `TaskCard` (lines 343-465): a card with a status-coloured left border, the
// title, the estimate, and a row of actions. Three adaptations, all forced by
// the input device:
//
//   1. Web's action cluster is a hover-revealed toolbar of five icon buttons
//      (`sm:opacity-0 sm:group-hover:opacity-100`, task-board.tsx:386). There
//      is no hover on a phone, and five 12px glyphs are not five tap targets.
//      What survives is the two actions a board is actually for — complete
//      (the same springy `CompleteCheckbox` the list rows use) and change
//      column — as full-size controls, with edit on the card body tap exactly
//      as it already works in the list view.
//   2. Web moves a card between columns by dragging it. Dragging a card
//      across horizontally-paged columns on a 390pt screen fights the pager
//      for the same gesture, so "Move" opens an explicit column picker. Same
//      capability, an idiom that can't misfire.
//   3. Web hides the description and metadata below `sm:`
//      (task-board.tsx:367-385); `TaskMetaChips compact` is that rule.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatDuration, type Task } from "@goalslot/shared";

import { CompleteCheckbox, ListCard, TONES, type Tone } from "@/components/lists";
import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { TaskMetaChips } from "./TaskMetaChips";

/**
 * Horizontal rail the completion checkbox occupies, so the chips on the next
 * line start under the title rather than under the checkbox. The checkbox is
 * a `minTouchTarget`-wide hit area pulled `spacing.sm` into the card padding,
 * then `spacing.sm` of row gap before the title. Same construction as
 * app/(app)/tasks.tsx's `CHECKBOX_RAIL`, with the board card's tighter gap.
 */
const CHECKBOX_RAIL = minTouchTarget - spacing.sm + spacing.sm;

export interface TaskBoardCardProps {
  task: Task;
  /** Column tone — paints the card's left stripe, same as the list rows. */
  tone: Tone;
  /** Column name, used in the Move control's screen-reader label. */
  columnTitle: string;
  /** Position within the column; drives ListCard's entrance stagger only. */
  index: number;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onMove: (task: Task) => void;
}

export function TaskBoardCard({ task, tone, columnTitle, index, onComplete, onEdit, onMove }: TaskBoardCardProps) {
  const isDone = task.status === "DONE";

  return (
    <ListCard
      accentColor={TONES[tone].accent}
      index={index}
      dimmed={isDone}
      onPress={() => onEdit(task)}
      accessibilityLabel={`${task.title}, in ${columnTitle}`}
      accessibilityHint="Opens the task editor"
      contentStyle={styles.content}
    >
      <View style={styles.titleRow}>
        <CompleteCheckbox
          checked={isDone}
          disabled={isDone}
          onPress={() => onComplete(task)}
          accessibilityLabel={`Complete "${task.title}"`}
        />
        <Text style={[styles.title, isDone && styles.titleDone]} numberOfLines={3}>
          {task.title}
        </Text>
      </View>

      <TaskMetaChips task={task} compact style={styles.chips} />

      <View style={styles.footer}>
        {/* Web shows the estimate as its own pill on the card
            (task-board.tsx:361-365); here it sits opposite Move so the
            footer row earns its height instead of holding one button. */}
        {task.estimatedMinutes ? (
          <Text style={styles.estimate}>{formatDuration(task.estimatedMinutes)}</Text>
        ) : (
          <View style={styles.footerSpacer} />
        )}

        <Pressable
          style={styles.moveButton}
          onPress={() => onMove(task)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Move "${task.title}" out of ${columnTitle}`}
          accessibilityHint="Opens the column picker"
        >
          <Text style={styles.moveLabel}>Move</Text>
          <Icon name="arrow-right" size={14} color={colors.foreground} />
        </Pressable>
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
    lineHeight: 19,
    // Centres the first text line on the checkbox: the checkbox's 44pt hit
    // area has -8 vertical margins, so it occupies 28pt of layout with its
    // box centred at 14; a 19pt line needs 4.5pt above it to match.
    paddingTop: spacing.xs,
  },
  titleDone: {
    textDecorationLine: "line-through",
    color: colors.mutedForeground,
  },
  chips: {
    paddingLeft: CHECKBOX_RAIL,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  footerSpacer: {
    flex: 1,
  },
  estimate: {
    ...typography.label,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  moveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    // Full 44pt tap target: a board is a screen you poke at repeatedly.
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moveLabel: {
    ...typography.label,
    color: colors.foreground,
  },
});
