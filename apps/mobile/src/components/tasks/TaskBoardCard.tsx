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
//      What survives is the three actions a board is actually for — complete
//      (the same springy `CompleteCheckbox` the list rows use, two-way here as
//      it is there), change column, and delete — as full-size controls, with
//      edit on the card body tap exactly as it already works in the list view.
//      Delete is here because it was previously reachable ONLY from the list
//      view's swipe, so what you could do to a task depended on which view
//      toggle you happened to be on.
//   2. Web moves a card between columns by dragging it. Dragging a card
//      across horizontally-paged columns on a 390pt screen fights the pager
//      for the same gesture, so "Move" opens an explicit column picker. Same
//      capability, an idiom that can't misfire.
//   3. Web hides the description and metadata below `sm:`
//      (task-board.tsx:367-385); `TaskMetaChips compact` is that rule.

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatDuration, type Task } from "@goalslot/shared";

import { CompleteCheckbox, ListCard, TONES, type Tone } from "@/components/lists";
import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { taskCompletionAction } from "./task-actions";
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
  /** Completes a live task, or restores a DONE one — see `taskCompletionAction`. */
  onToggleComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onMove: (task: Task) => void;
  /** Opens the screen's delete confirmation — the same one the list swipe uses. */
  onDelete: (task: Task) => void;
}

// Memoised: BoardColumn already hands this stable (useCallback) handlers via
// its own `renderItem`, so without this every card in a column re-rendered
// whenever the board re-rendered for a reason unrelated to that card (e.g.
// another column's task list changing, or the board's own layout effect
// firing) rather than only when its own task/tone/column changed.
export const TaskBoardCard = memo(function TaskBoardCard({
  task,
  tone,
  columnTitle,
  index,
  onToggleComplete,
  onEdit,
  onMove,
  onDelete,
}: TaskBoardCardProps) {
  const isDone = task.status === "DONE";
  const completion = taskCompletionAction(task);

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
        {/* Two-way, same as the list row's: a card in the Done column can be
            un-ticked in place rather than only via the Move sheet. */}
        <CompleteCheckbox
          checked={isDone}
          onPress={() => onToggleComplete(task)}
          accessibilityLabel={completion.accessibilityLabel}
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

        <View style={styles.actions}>
          {/* Icon-only, and the quieter of the two: Move is what a board is
              for and keeps its word, while Delete gets the colour instead of
              the width. It opens the screen's ConfirmDialog — a board card
              has no swipe to make destructive intent explicit the way the
              list row does, so the confirmation is the whole of the guard
              here. */}
          <Pressable
            style={styles.deleteButton}
            onPress={() => onDelete(task)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Delete "${task.title}"`}
            accessibilityHint="Asks for confirmation first"
          >
            <Icon name="trash" size={16} color={colors.destructive} />
          </Pressable>

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
      </View>
    </ListCard>
  );
});

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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  deleteButton: {
    alignItems: "center",
    justifyContent: "center",
    // Same 44pt floor as Move — a destructive control is the last one that
    // should be harder to hit accurately than the thing beside it.
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    borderRadius: radii.lg,
    // A soft rose chip rather than Move's bordered secondary one: the fill is
    // what makes an icon-only target visible (an unfilled 44pt hit area has no
    // edge to aim at), and dropping the border keeps it from reading as a
    // second equally-weighted primary action beside the one a board is
    // actually for.
    backgroundColor: colors.destructiveMuted,
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
