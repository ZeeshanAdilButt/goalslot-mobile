// "What am I timing?" — the block directly under the ring.
//
// Goal and task are two independent, always-tappable slots rather than one
// resolved title, so either can be set without the other.
//
// Attribution is editable mid-session: the store's `retarget` action
// re-points goalId/taskId without touching startedAt or pausedElapsedMs.
//
// Every title routes through `cleanLabel` (src/lib/timer-attribution.ts) so a
// blank string renders as no title rather than an empty row.
//
// The `*Unresolved` props distinguish "nothing attached" from "an id is set
// but the goal/task lists haven't loaded yet" — the two look identical on
// screen otherwise but need opposite copy.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cleanLabel } from "@/lib/timer-attribution";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Combines a slot's category and its schedule note into one subtitle line, dropping whichever half is absent. */
function joinWithDot(a: string | null, b: string | null): string | null {
  const parts = [a, b].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The schedule block that's live right now.
 *
 * Offered as a one-tap attribution (the dashed "Scheduled now" chip) while
 * the goal slot is empty — that's the case `showSuggestionChip` below
 * gates on. Once a goal IS attached, the same data still has a job: telling
 * the user which block is live gets downgraded from an actionable suggestion
 * to passive context folded into the Goal slot's own subtitle line (see
 * `scheduleNote` below) rather than a separate row — the block may just be
 * informational (or may not even match what's attached), not something to
 * apply, and it belongs to the same "what's this session tagged with" input
 * the goal/category text already lives in, not a second one.
 */
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
  suggestion,
  onPressGoal,
  onPressTask,
  onApplySuggestion,
}: TrackingTargetProps) {
  // Defensive: cleanLabel is re-applied here even though callers already normalise.
  const goalTitle = cleanLabel(goalLabel);
  const taskTitle = cleanLabel(taskLabel);
  const goalCategory = cleanLabel(goalSublabel);
  const name = cleanLabel(sessionName);
  const accent = accentColor ?? colors.mutedForeground;

  const hasSuggestion = suggestion !== null && suggestion !== undefined;
  // The actionable chip only makes sense while there's genuinely nothing
  // attached yet — once a goal is set (or its id is set but still resolving,
  // `goalUnresolved`), applying the suggestion would silently overwrite it.
  const showSuggestionChip = hasSuggestion && goalTitle === null && !goalUnresolved;
  // The passive fallback: once a goal is attached, "what's scheduled right
  // now" folds into the Goal slot's own subtitle instead of a separate row —
  // see this file's header for why.
  const scheduleNote = hasSuggestion && !showSuggestionChip ? suggestion.blockTitle : null;
  const goalSubtitle = goalTitle !== null ? joinWithDot(goalCategory, scheduleNote ? `Scheduled: ${scheduleNote}` : null) : null;
  // A session name that just repeats a slot's title is noise, not information.
  const showName = name !== null && name !== goalTitle && name !== taskTitle;

  return (
    <View style={styles.container}>
      {showName ? (
        <Text style={styles.sessionName} numberOfLines={1}>
          Tracking “{name}”
        </Text>
      ) : null}

      {showSuggestionChip ? (
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
        subtitle={goalSubtitle}
        unresolved={goalUnresolved}
        accent={goalTitle !== null ? accent : null}
        emptyIcon="goals"
        emptyTitle="No goal selected"
        emptySubtitle={null}
        unresolvedTitle="Goal attached"
        accessibilityLabel={
          goalTitle !== null
            ? `Goal: ${goalTitle}${scheduleNote ? `. Scheduled: ${scheduleNote}` : ""}. Change it`
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
        emptySubtitle={null}
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
  /** Null keeps an empty slot to a single line — the row's own title already says what it's for. */
  emptySubtitle: string | null;
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
