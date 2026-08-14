// "What am I timing?" — the block directly under the ring.
//
// TWO SLOTS, NOT ONE. This used to be a single row showing one resolved title
// (a task's, or a goal's, whichever existed) with the other rendered as a
// sublabel at best. That made the goal and the task look like one indivisible
// choice: there was no way to see that a goal was set but a task wasn't, and
// no way to add a task to a session that already had a goal without going back
// through a picker that read as "replace what you chose". The reported symptom
// was exactly that — "no option to select goal and task both". So the goal and
// the task are now separate, independently tappable rows, each showing its own
// state and each opening the picker scoped to itself. A task is still optional
// and says so on its face.
//
// EVERY ROW IS ALWAYS PRESSABLE, including mid-session. Attribution used to
// lock the moment a session began, on the reasoning that the store's
// taskId/goalId was fixed for the life of a run. That inverted when starting
// stopped requiring a target: attaching a goal *while the clock runs* is now
// the ordinary way a session gets attributed. The store's `retarget` action is
// what makes it safe — re-pointing never touches startedAt or pausedElapsedMs,
// so the clock is undisturbed.
//
// A BLANK ROW IS NOT A STATE. Titles arrive from the network unvalidated, and
// a session whose name came back as `""` used to take the "we have a title"
// branch and render a row with no text in it at all — a box with a "Change"
// affordance and nothing else, which is what the user actually saw. Both slots
// route every title through `cleanLabel` (src/lib/timer-attribution.ts), so a
// blank string is treated as no title rather than as an empty one.
//
// THREE STATES PER SLOT, NOT TWO. "Nothing is attached" and "something is
// attached but we can't tell what yet" look identical on screen if you let
// them, and they need opposite copy: the first is a fine end state the user
// chose, the second is a transient cold-start gap where an id exists but the
// goal/task lists haven't loaded. The `*Unresolved` props separate them.
//
// THE SUGGESTION ROW is the way out of an unattributed session during a
// planned block: the schedule-linked goal, offered as one tap, right where the
// missing attribution is. It only appears when the goal slot is empty, so it
// can never compete with a choice the user already made.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cleanLabel } from "@/lib/timer-attribution";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** The schedule block that's live right now, offered as a one-tap attribution. */
export interface TrackingTargetSuggestion {
  blockTitle: string;
  goalTitle: string;
  /** The block's own task, when it names one — applied along with the goal. */
  taskTitle?: string | null;
  color?: string | null;
}

export interface TrackingTargetProps {
  /** Resolved goal title, or null when no goal is attached. */
  goalLabel: string | null;
  /** Secondary line for the goal row — its category. */
  goalSublabel?: string | null;
  /** Resolved task title, or null when no task is attached. */
  taskLabel: string | null;
  /**
   * The free-text name a cross-device session can carry instead of a real
   * task ("log this as 'gym'", from the Coach). Shown as a caption above the
   * slots, and only when it isn't just repeating one of them.
   */
  sessionName?: string | null;
  /** Goal colour, used as the identifying accent. Null falls back to neutral. */
  accentColor?: string | null;
  /** A goal id is set but its title hasn't resolved yet — see this file's header. */
  goalUnresolved?: boolean;
  /** A task id is set but its title hasn't resolved yet. */
  taskUnresolved?: boolean;
  /** True while a session is running or paused, which changes the copy. */
  running: boolean;
  suggestion?: TrackingTargetSuggestion | null;
  onPressGoal: () => void;
  onPressTask: () => void;
  onApplySuggestion?: () => void;
}

export function TrackingTarget({
  goalLabel,
  goalSublabel,
  taskLabel,
  sessionName,
  accentColor,
  goalUnresolved = false,
  taskUnresolved = false,
  running,
  suggestion,
  onPressGoal,
  onPressTask,
  onApplySuggestion,
}: TrackingTargetProps) {
  // Defensive even though the screen already normalises these: this component
  // is the last thing between an unvalidated network string and a row with
  // nothing in it, and that is the bug this file exists to make impossible.
  const goalTitle = cleanLabel(goalLabel);
  const taskTitle = cleanLabel(taskLabel);
  const goalCategory = cleanLabel(goalSublabel);
  const name = cleanLabel(sessionName);
  const accent = accentColor ?? colors.mutedForeground;

  const showSuggestion = suggestion !== null && suggestion !== undefined && goalTitle === null && !goalUnresolved;
  // A session name that just repeats a slot's title is noise, not information.
  const showName = name !== null && name !== goalTitle && name !== taskTitle;

  return (
    <View style={styles.container}>
      {showName ? (
        <Text style={styles.sessionName} numberOfLines={1}>
          Tracking “{name}”
        </Text>
      ) : null}

      {showSuggestion ? (
        <Pressable
          style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
          onPress={onApplySuggestion}
          accessibilityRole="button"
          accessibilityLabel={`Scheduled now: ${suggestion.blockTitle}. Track it against ${suggestion.goalTitle}${
            suggestion.taskTitle ? `, task ${suggestion.taskTitle}` : ""
          }`}
        >
          <View style={styles.emptyGlyph}>
            <Icon name="schedule" size={16} color={colors.mutedForeground} />
          </View>
          <View style={styles.body}>
            <Text style={styles.eyebrow}>Scheduled now · {suggestion.blockTitle}</Text>
            <Text style={styles.title} numberOfLines={1}>
              {suggestion.goalTitle}
              {suggestion.taskTitle ? ` · ${suggestion.taskTitle}` : ""}
            </Text>
          </View>
          <View style={[styles.useChip, { borderColor: suggestion.color ?? colors.border }]}>
            <Text style={styles.useChipText}>Use</Text>
          </View>
        </Pressable>
      ) : null}

      <Slot
        eyebrow="Goal"
        title={goalTitle}
        subtitle={goalTitle !== null ? goalCategory : null}
        unresolved={goalUnresolved}
        accent={goalTitle !== null ? accent : null}
        emptyIcon="goals"
        emptyTitle="No goal selected"
        emptySubtitle={running ? "Tap to file this session under a goal" : "Tap to choose — or just press start"}
        unresolvedTitle="Goal attached"
        accessibilityLabel={
          goalTitle !== null
            ? `Goal: ${goalTitle}. Change it`
            : goalUnresolved
              ? "A goal is attached, still loading its name. Change it"
              : "No goal selected. Choose a goal"
        }
        onPress={onPressGoal}
      />

      <Slot
        eyebrow="Task · optional"
        title={taskTitle}
        subtitle={null}
        unresolved={taskUnresolved}
        accent={taskTitle !== null ? accent : null}
        emptyIcon="tasks"
        emptyTitle="Add a task"
        emptySubtitle={
          running ? "Optional — narrows this session to one task" : "Optional — you can add one while tracking"
        }
        unresolvedTitle="Task attached"
        accessibilityLabel={
          taskTitle !== null
            ? `Task: ${taskTitle}. Change it`
            : taskUnresolved
              ? "A task is attached, still loading its name. Change it"
              : "No task selected. Add a task. Optional"
        }
        onPress={onPressTask}
      />
    </View>
  );
}

interface SlotProps {
  eyebrow: string;
  title: string | null;
  subtitle: string | null;
  unresolved: boolean;
  accent: string | null;
  emptyIcon: IconName;
  emptyTitle: string;
  emptySubtitle: string;
  unresolvedTitle: string;
  accessibilityLabel: string;
  onPress: () => void;
}

/**
 * One attribution row. Filled, unresolved and empty are the same component so
 * the hero card's height doesn't jump as a session gains attribution (a card
 * that resizes under the transport controls is what makes a timer screen feel
 * unstable).
 */
function Slot({
  eyebrow,
  title,
  subtitle,
  unresolved,
  accent,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
  unresolvedTitle,
  accessibilityLabel,
  onPress,
}: SlotProps) {
  const filled = title !== null;
  const bodyTitle = title ?? (unresolved ? unresolvedTitle : emptyTitle);
  const bodySubtitle = filled ? subtitle : unresolved ? "Still loading its name" : emptySubtitle;

  return (
    <Pressable
      style={({ pressed }) => [filled ? styles.filledSlot : styles.emptySlot, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {filled && accent ? (
        <View style={[styles.rail, { backgroundColor: accent }]} />
      ) : (
        <View style={styles.emptyGlyph}>
          {/* `timer` is the Icon set's Clock glyph — there is no bare "clock"
              name; see src/components/ui/Icon.tsx. */}
          <Icon name={unresolved ? "timer" : emptyIcon} size={16} color={colors.mutedForeground} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={filled ? styles.title : styles.emptyTitle} numberOfLines={1}>
          {bodyTitle}
        </Text>
        {bodySubtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {bodySubtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.changeAffordance}>
        {filled ? <Text style={styles.changeText}>Change</Text> : null}
        <Icon name="chevron" size={filled ? 14 : 18} color={colors.mutedForeground} />
      </View>
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
  container: {
    width: "100%",
    gap: spacing.sm,
  },
  sessionName: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.xs,
  },
  suggestion: {
    ...slotBase,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
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
  eyebrow: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
  },
  title: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  useChip: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    backgroundColor: colors.background,
  },
  useChipText: {
    ...typography.label,
    color: colors.foreground,
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
