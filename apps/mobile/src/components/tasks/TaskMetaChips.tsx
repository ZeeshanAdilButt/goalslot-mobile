// The chip row under a task title.
//
// A direct port of dw-time-web/src/features/tasks/components/task-list-item/
// task-metadata.tsx — category / linked goal / schedule block / due date,
// with the goal chip tinted from the goal's own colour — plus the estimate
// the web board card carries as its own pill (task-board.tsx:361-365).
//
// It lives here rather than inline in app/(app)/tasks.tsx because the list row
// and the board card render the same chips from the same task. `compact` is
// what the board asks for: web's board card hides the description and the
// goal/due chip row below the `sm:` breakpoint (task-board.tsx:367-385) —
// i.e. exactly the phone case — so a phone-width board column keeps only the
// two chips that identify a card at a glance and drops the rest to the editor.

import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { formatDuration, formatTime12h, type Task } from "@goalslot/shared";

import { MetaChip } from "@/components/lists";
import { spacing } from "@/theme/tokens";
import { formatDueDate } from "./due-date";

// `formatDueDate` used to be a bare alias for `formatDateKey` here, which
// assumed `task.dueDate` was a "YYYY-MM-DD" key. It isn't — the API sends a
// full ISO instant, and that assumption rendered "DUE INVALID DATE". The real
// implementation now lives in ./due-date.ts (see its header); it's re-exported
// so this module's public surface is unchanged for existing importers.
export { formatDueDate, toDueDateKey } from "./due-date";

export interface TaskMetaChipsProps {
  task: Task;
  /** Board-card mode: goal + due date only. See the note at the top. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders nothing at all when a task has no metadata, so bare tasks stay a
 * single compact line instead of reserving empty space.
 */
export function TaskMetaChips({ task, compact = false, style }: TaskMetaChipsProps) {
  // Distinguishes a queued edit/complete/delete (still offline, waiting to
  // sync) from a genuinely-saved task — the two would otherwise render
  // identically. See Task.pendingSync's own header note for where this gets
  // set. Shown in both compact (board card) and full (list row) modes: it's
  // important enough at-a-glance information to survive the board's
  // "hide everything but goal/due" rule.
  const pendingChip = task.pendingSync ? <MetaChip icon="refresh" label="Queued" /> : null;
  const goalChip = task.goal ? (
    <MetaChip icon="goals" label={task.goal.title} accentColor={task.goal.color} />
  ) : null;
  // Gate on the FORMATTED label, not on `task.dueDate` being truthy: a value
  // that can't be read as a calendar day has to drop the chip entirely, or
  // it renders as a rendering failure. That truthiness check is exactly why
  // the broken chip appeared at all.
  const dueLabel = formatDueDate(task.dueDate);
  const dueChip = dueLabel ? <MetaChip icon="schedule" tone="warning" label={`Due ${dueLabel}`} /> : null;

  if (compact) {
    if (!pendingChip && !goalChip && !dueChip) return null;
    return (
      <View style={[styles.chipRow, style]}>
        {pendingChip}
        {goalChip}
        {dueChip}
      </View>
    );
  }

  const hasMeta =
    !!task.category || !!task.goal || !!task.scheduleBlock || !!dueLabel || !!task.estimatedMinutes || !!task.pendingSync;
  if (!hasMeta) return null;

  return (
    <View style={[styles.chipRow, style]}>
      {pendingChip}
      {task.category ? <MetaChip label={task.category.replace("_", " ")} /> : null}
      {goalChip}
      {task.scheduleBlock ? (
        <MetaChip
          icon="timer"
          label={`${formatTime12h(task.scheduleBlock.startTime)} – ${formatTime12h(task.scheduleBlock.endTime)}`}
        />
      ) : null}
      {dueChip}
      {task.estimatedMinutes ? <MetaChip icon="timer" label={formatDuration(task.estimatedMinutes)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
