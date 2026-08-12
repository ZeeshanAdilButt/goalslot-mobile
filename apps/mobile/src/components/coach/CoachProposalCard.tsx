// The card that shows what the assistant wants to change, and the only
// place in the app where a Coach proposal can be applied.
//
// It was previously inline in app/(app)/coach.tsx and read-only, with the
// footnote "open GoalSlot on the web to apply this". Voice needs the same
// card and needs it to actually work, and having two of them — one the user
// can act on and one they cannot — would be worse than either. So it moved
// here and grew an Apply button, and the Coach screen renders this exact
// component. A spoken change and a typed one are now literally the same
// confirmation.
//
// CONFIRMATION IS THE POINT. Nothing here applies on render, on mount, or on
// a swipe. A batch that contains a delete asks a second time through the
// platform's own alert, naming what will go, because a misheard word must
// never be able to remove a goal someone has been working toward for
// months.

import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import type { CoachProposalAction, CoachProposalActionType, CoachProposalBlock } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Human label per action type. Kept exhaustive by the Record's key type. */
const ACTION_LABELS: Record<CoachProposalActionType, string> = {
  RENAME_GOAL: "Rename goal",
  UPDATE_GOAL: "Update goal",
  CREATE_GOAL: "Create goal",
  DELETE_GOAL: "Delete goal",
  CREATE_SCHEDULE_BLOCK: "Add schedule block",
  UPDATE_SCHEDULE_BLOCK: "Update schedule block",
  DELETE_SCHEDULE_BLOCK: "Remove schedule block",
  CREATE_TIME_ENTRY: "Log time",
  UPDATE_TIME_ENTRY: "Update time entry",
  DELETE_TIME_ENTRY: "Delete time entry",
  CREATE_TASK: "Create task",
  UPDATE_TASK: "Update task",
  DELETE_TASK: "Delete task",
  CREATE_PRACTICE: "Add active practice",
};

const DESTRUCTIVE_TYPES = new Set<CoachProposalActionType>([
  "DELETE_GOAL",
  "DELETE_SCHEDULE_BLOCK",
  "DELETE_TIME_ENTRY",
  "DELETE_TASK",
]);

export function isDestructiveProposal(block: CoachProposalBlock): boolean {
  return block.actions.some((action) => DESTRUCTIVE_TYPES.has(action.type));
}

/**
 * Summary of a proposed action's payload. Shows the fields the model
 * actually sent (title, times, date, duration) rather than resolving ids
 * against the query cache the way web's `describeAction` does — an id
 * lookup that misses would render an empty row on the one card whose whole
 * job is telling the user what they are agreeing to.
 */
function describeProposalAction(action: CoachProposalAction): string | null {
  const payload = action.payload ?? {};
  const bits: string[] = [];
  if (typeof payload.title === "string") bits.push(`"${payload.title}"`);
  if (typeof payload.startTime === "string" && typeof payload.endTime === "string") {
    bits.push(`${payload.startTime}–${payload.endTime}`);
  }
  if (typeof payload.date === "string") bits.push(payload.date);
  if (typeof payload.deadline === "string") bits.push(`due ${payload.deadline}`);
  if (typeof payload.duration === "number") bits.push(`${payload.duration} min`);
  if (bits.length === 0 && action.id) bits.push(`#${action.id.slice(0, 8)}`);
  return bits.length > 0 ? bits.join(" · ") : null;
}

/** One line naming everything a destructive batch will remove. */
function describeDeletions(block: CoachProposalBlock): string {
  const deletions = block.actions.filter((action) => DESTRUCTIVE_TYPES.has(action.type));
  const named = deletions
    .map((action) => describeProposalAction(action))
    .filter((description): description is string => description !== null);
  if (named.length === 0) return "This removes data that can't be brought back.";
  return `This permanently removes ${named.join(", ")}.`;
}

export interface CoachProposalCardProps {
  block: CoachProposalBlock;
  /**
   * Applies the batch. Resolves with a sentence to show on success, rejects
   * with a user-facing message. Omit to render the card read-only — the
   * offline case, and anywhere there is no live conversation to apply
   * against.
   */
  onApply?: (actions: CoachProposalAction[]) => Promise<string>;
  /** Dismisses without applying. Omit to hide the dismiss control. */
  onDismiss?: () => void;
}

type CardState =
  | { phase: "idle" }
  | { phase: "applying" }
  | { phase: "applied"; message: string }
  | { phase: "failed"; message: string };

export function CoachProposalCard({ block, onApply, onDismiss }: CoachProposalCardProps) {
  const [state, setState] = useState<CardState>({ phase: "idle" });
  const destructive = isDestructiveProposal(block);

  const run = useCallback(async () => {
    if (onApply === undefined) return;
    setState({ phase: "applying" });
    try {
      const message = await onApply(block.actions);
      setState({ phase: "applied", message });
    } catch (err) {
      setState({
        phase: "failed",
        message: err instanceof Error ? err.message : "Couldn't apply that change.",
      });
    }
  }, [block.actions, onApply]);

  const handleApply = useCallback(() => {
    if (!destructive) {
      void run();
      return;
    }
    // Second gate, and the platform's own alert rather than an in-card
    // confirm: a delete should look like every other delete in the OS, and
    // the destructive button style is what a user reads before the words.
    Alert.alert("Apply this change?", describeDeletions(block), [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run() },
    ]);
  }, [block, destructive, run]);

  const applied = state.phase === "applied";
  const actionCount = block.actions.length;
  const summaryForScreenReader = `Proposed change. ${block.summary ?? ""} ${actionCount} ${
    actionCount === 1 ? "action" : "actions"
  }.${destructive ? " Includes a deletion." : ""}`;

  return (
    <View
      style={[styles.card, applied && styles.cardApplied]}
      accessible={false}
      accessibilityLabel={summaryForScreenReader}
    >
      <View style={[styles.header, applied && styles.headerApplied]}>
        <Text style={styles.headerLabel} accessibilityLabel={summaryForScreenReader}>
          {applied ? "APPLIED" : "PROPOSED CHANGE"}
        </Text>
        {block.summary ? <Text style={styles.summary}>{block.summary}</Text> : null}
      </View>

      {block.actions.map((action, index) => {
        const detail = describeProposalAction(action);
        const isDestructive = DESTRUCTIVE_TYPES.has(action.type);
        return (
          <View key={`${action.type}-${index}`} style={styles.row}>
            <Text style={[styles.actionLabel, isDestructive && styles.actionLabelDestructive]}>
              {ACTION_LABELS[action.type] ?? action.type}
            </Text>
            {detail ? <Text style={styles.actionDetail}>{detail}</Text> : null}
          </View>
        );
      })}

      {state.phase === "applied" ? (
        <View style={styles.resultRow} accessibilityLiveRegion="polite">
          <Icon name="check" size={iconSize.sm} color={colors.success} />
          <Text style={styles.resultText}>{state.message}</Text>
        </View>
      ) : null}

      {state.phase === "failed" ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {state.message}
        </Text>
      ) : null}

      {onApply === undefined ? (
        <Text style={styles.footnote}>
          {destructive ? "Includes a delete. " : ""}
          Preview only — nothing has changed.
        </Text>
      ) : applied ? null : (
        <View style={styles.footer}>
          {onDismiss ? (
            <Pressable
              onPress={onDismiss}
              disabled={state.phase === "applying"}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this proposed change"
              style={({ pressed }) => [styles.dismissButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.dismissText}>Not now</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleApply}
            disabled={state.phase === "applying"}
            accessibilityRole="button"
            accessibilityLabel={
              destructive
                ? `Apply ${actionCount === 1 ? "this change" : `these ${actionCount} changes`}, including a deletion`
                : `Apply ${actionCount === 1 ? "this change" : `these ${actionCount} changes`}`
            }
            accessibilityState={{ disabled: state.phase === "applying", busy: state.phase === "applying" }}
            style={({ pressed }) => [
              styles.applyButton,
              destructive && styles.applyButtonDestructive,
              state.phase === "applying" && styles.applyButtonBusy,
              pressed && styles.buttonPressed,
            ]}
          >
            {state.phase === "applying" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.applyText, destructive && styles.applyTextDestructive]}>
                {state.phase === "failed" ? "Try again" : destructive ? "Review & apply" : "Apply"}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xs,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  cardApplied: {
    borderColor: colors.success,
  },
  header: {
    backgroundColor: colors.warningMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
  },
  headerApplied: {
    backgroundColor: colors.successMuted,
  },
  headerLabel: {
    ...typography.label,
    color: colors.foreground,
  },
  summary: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.foreground,
  },
  row: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xxs,
  },
  actionLabel: {
    ...typography.caption,
    color: colors.foreground,
  },
  actionLabelDestructive: {
    color: colors.destructive,
  },
  actionDetail: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resultText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },
  errorText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  footnote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dismissButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  dismissText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  applyButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.primary,
  },
  applyButtonDestructive: {
    backgroundColor: colors.destructive,
  },
  applyButtonBusy: {
    backgroundColor: colors.foreground,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  applyText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
  applyTextDestructive: {
    color: colors.destructiveForeground,
  },
});
