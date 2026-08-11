// One goal row.
//
// Lifted out of app/(app)/goals.tsx unchanged in intent — same ListCard
// surface, same ProgressRing, same Done/Delete actions — so that screen goes
// back to being about data flow and this file can carry the presentation
// detail. The web original is
// dw-time-web/src/features/goals/components/goal-item.tsx:
//   - `border-l-[5px]` in `goal.color`            -> ListCard `accentColor`
//   - status dot + uppercase category eyebrow     -> `eyebrowRow`
//   - `loggedHours.toFixed(1)h / targetHoursh`    -> `hours`
//   - the progress bar + big percent pair         -> one ProgressRing
//   - labels capped at four (goal-item.tsx:108)   -> `.slice(0, 4)`
//
// ACCESSIBILITY is the substantive change. The row previously announced
// "Edit "<title>", button" and then exposed the ring as a SECOND focus stop
// ("57 percent complete, progress bar") with the category, hours, status and
// deadline never announced at all — so a screen-reader user swiped through
// fragments of a goal and never heard most of it. Now the card is one focus
// stop carrying the whole row, the purely decorative parts (ring, status dot)
// are hidden from the tree, and the two real controls keep their own stops.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { calculateProgressPercent, type Goal } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { ListCard, MetaChip, ProgressRing, safeColor, StatusPill, type Tone } from "@/components/lists";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { deadlineUrgency, describeDeadline, toDeadlineKey, type DeadlineUrgency } from "./deadline";

/** goal-item.tsx:108-120 caps the rendered label list at four. */
const MAX_LABELS = 4;

/**
 * The chip's colour follows what the date MEANS. The previous version pinned
 * every deadline to `warning`, which made a goal due in eight months look
 * exactly as urgent as one that was already late.
 */
const DEADLINE_TONE: Record<DeadlineUrgency, Tone> = {
  overdue: "danger",
  today: "warning",
  soon: "warning",
  later: "muted",
};

/**
 * `loggedHours` / `targetHours` are typed as numbers, but a single malformed
 * record reaching `.toFixed()` would take down the whole list rather than one
 * row, so the read is defensive.
 */
function formatHours(value: number, fractionDigits = 1): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : "0";
}

/** Whole hours print as "40h", fractional targets as "37.5h". */
function formatTarget(value: number): string {
  if (!Number.isFinite(value)) return "0h";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}h`;
}

const STATUS_PILL: Record<Exclude<Goal["status"], "ACTIVE">, { label: string; tone: Tone }> = {
  COMPLETED: { label: "Completed", tone: "success" },
  // Paused reads as "set aside", not as an achievement or a problem — the
  // muted tone is the same one web gives a non-active status dot
  // (goal-item.tsx:70, `bg-zinc-300`).
  PAUSED: { label: "Paused", tone: "muted" },
};

export interface GoalCardProps {
  goal: Goal;
  /** Position in the list — drives ListCard's entrance stagger only. */
  index: number;
  /** Today as "YYYY-MM-DD", passed in so every row in a list agrees on it. */
  todayKey: string;
  onComplete: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
}

export function GoalCard({ goal, index, todayKey, onComplete, onDelete, onEdit }: GoalCardProps) {
  const progress = calculateProgressPercent(goal.loggedHours, goal.targetHours);
  const accent = safeColor(goal.color, colors.primary);
  // Null for an active goal (which gets the Done button instead of a pill) —
  // resolved once here so the status narrowing happens in one place.
  const statusPill = goal.status === "ACTIVE" ? null : STATUS_PILL[goal.status];
  const isActive = statusPill === null;

  const deadlineKey = toDeadlineKey(goal.deadline);
  const labels = (goal.labels ?? []).slice(0, MAX_LABELS);
  const hasChips = deadlineKey !== null || labels.length > 0;

  // One sentence per fact, in the order a sighted user reads the card.
  const spokenLabel = [
    goal.title,
    goal.category,
    statusPill ? statusPill.label : "Active",
    `${progress}% complete`,
    `${formatHours(goal.loggedHours)} of ${formatTarget(goal.targetHours)} logged`,
    deadlineKey ? describeDeadline(deadlineKey, todayKey) : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <ListCard
      accentColor={accent}
      index={index}
      dimmed={!isActive}
      onPress={() => onEdit(goal)}
      accessibilityLabel={spokenLabel}
      accessibilityHint="Opens this goal for editing"
      // Rows used to sit flush against each other: ListCard carries no margin
      // and FlashList adds no separator, so Goals was the only list in the app
      // whose cards touched. tasks.tsx spaces them the same amount via its own
      // `rowWrap`, categories.tsx via a `gap` on the container.
      style={styles.card}
    >
      <View style={styles.rowTop}>
        {/* Hidden from the tree: the percentage it shows is already the fourth
            clause of the card's own label, and leaving it exposed made every
            goal cost two swipes. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ProgressRing progress={progress} color={accent} />
        </View>

        <View style={styles.rowBody}>
          {/* Eyebrow: status dot + category — the pairing at goal-item.tsx:66-79,
              where the dot carries `aria-hidden` for the same reason it's
              hidden here. */}
          <View style={styles.eyebrowRow}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.statusDot, { backgroundColor: isActive ? colors.success : colors.mutedForeground }]}
            />
            <Text style={styles.category} numberOfLines={1}>
              {goal.category}
            </Text>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {goal.title}
          </Text>

          {/* goal-item.tsx:132-135 — logged hours bold, target muted beside it. */}
          <Text style={styles.hours}>
            {formatHours(goal.loggedHours)}h
            <Text style={styles.hoursTarget}> / {formatTarget(goal.targetHours)}</Text>
          </Text>
        </View>
      </View>

      {hasChips ? (
        <View style={styles.chipRow}>
          {deadlineKey ? (
            <MetaChip
              icon="schedule"
              tone={DEADLINE_TONE[deadlineUrgency(deadlineKey, todayKey)]}
              label={describeDeadline(deadlineKey, todayKey)}
            />
          ) : null}
          {labels.map((goalLabel) => (
            <MetaChip key={goalLabel.label.id} label={goalLabel.label.name} accentColor={goalLabel.label.color} />
          ))}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {statusPill ? (
          // Paused and completed goals change status from the edit sheet
          // rather than growing a second inline mutation — same place web
          // puts it (goal-modal.tsx's Status select, shown only when editing).
          <StatusPill label={statusPill.label} tone={statusPill.tone} />
        ) : (
          // Plain Pressable, not PressableScale: this sits inside ListCard's
          // own press-scale surface, and two nested spring transforms on one
          // touch read as a glitch rather than as feedback.
          <Pressable
            style={styles.completeButton}
            onPress={() => onComplete(goal)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Mark "${goal.title}" complete`}
            accessibilityHint="Moves this goal to the Completed tab"
          >
            <Icon name="check" size={16} color={colors.success} />
            <Text style={styles.completeButtonText}>Done</Text>
          </Pressable>
        )}

        <Pressable
          style={styles.deleteButton}
          onPress={() => onDelete(goal)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete "${goal.title}"`}
          accessibilityHint="Asks for confirmation first"
        >
          <Icon name="trash" size={16} color={colors.destructive} />
        </Pressable>
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  category: {
    ...typography.label,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  title: {
    ...typography.title,
    color: colors.foreground,
    lineHeight: 21,
  },
  hours: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.foreground,
    marginTop: spacing.xxs,
  },
  hoursTarget: {
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    // Was `minTouchTarget - spacing.md` (32pt) and rescued only by hitSlop,
    // which overlaps the delete button's own hitSlop on a narrow card.
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.successMuted,
  },
  completeButtonText: {
    ...typography.caption,
    color: colors.success,
  },
  deleteButton: {
    // Was 40pt. Destructive actions are the last place to shave a target.
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
});
