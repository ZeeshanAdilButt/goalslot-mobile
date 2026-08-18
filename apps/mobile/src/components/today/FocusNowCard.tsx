// The Today screen's hero: "what is happening right now".
//
// This is dw-time-web's src/components/focus-now-bar.tsx re-thought for a
// phone. The web version is a full-width horizontal ticker docked under the
// top bar — a shape that only works when you have 1200px of horizontal room
// and a persistent chrome to dock into. Mobile keeps every semantic the bar
// carries (pulsing live dot, "Focus now" eyebrow, block title, linked goal,
// time window, "Xm left" countdown, elapsed progress, link into the
// schedule) and re-lays them as a stacked card, with the progress promoted
// from a 2px hairline to a ring (see ProgressRing.tsx for why).
//
// Crucially the web bar returns `null` when nothing is active
// (focus-now-bar.tsx:82) — it can afford to, because the dashboard behind it
// is full. Today has no such luxury: "nothing is running" is the single most
// common state and it's exactly the state users called out as broken. So the
// card never disappears; it degrades to "up next", then to a designed,
// actionable empty state.

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { formatDuration, formatTime12h, type ScheduleBlock, type Task } from "@goalslot/shared";

import { ErrorState } from "@/components/ErrorState";
import { Icon } from "@/components/ui/Icon";
import { PressableScale } from "@/components/today/PressableScale";
import { ProgressRing } from "@/components/today/ProgressRing";
import { SectionEmpty } from "@/components/today/SectionEmpty";
import { Skeleton } from "@/components/Skeleton";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const RING_SIZE = 86;

export interface FocusNowCardProps {
  loading: boolean;
  /**
   * The schedule request failed with nothing cached to fall back on. Without
   * this the card would render its "Your day is wide open" empty state on a
   * network error — telling the user they have nothing scheduled when the
   * truth is we don't know. See the same guard on every section in
   * app/(app)/index.tsx.
   */
  error?: boolean;
  onRetry?: () => void;
  activeBlock: ScheduleBlock | null;
  /** Elapsed fraction + minutes remaining for `activeBlock`. Derived by the caller. */
  activeProgress: { pct: number; minutesLeft: number } | null;
  nextBlock: ScheduleBlock | null;
  /** Human countdown for `nextBlock` ("in 25m"), phrased the way the web bar phrases it. */
  nextLabel: string | null;
  /** Opens the schedule — the web bar's "View Schedule" link. */
  onOpenSchedule: () => void;
  /**
   * Incomplete tasks under `activeBlock.goal`, already capped by the caller
   * (see GOAL_TASK_PREVIEW_COUNT in app/(app)/index.tsx) — this component
   * doesn't slice. Omitted or empty renders nothing: a card this dense
   * doesn't get an empty state of its own for "no tasks", it just quietly
   * doesn't grow.
   */
  goalTasks?: Task[];
  /** Matching tasks beyond what `goalTasks` already includes, for a "+N more" row. */
  goalTasksHiddenCount?: number;
  /** Opens `task` in the Tasks tab's own EditTaskSheet (via its `?taskId=` deep link). */
  onTaskPress?: (task: Task) => void;
  /** "+N more" tap target — the Tasks tab, unfiltered (same destination `onOpenSchedule`'s sibling sections use for their own overflow). */
  onViewAllGoalTasks?: () => void;
}

export function FocusNowCard({
  loading,
  error = false,
  onRetry,
  activeBlock,
  activeProgress,
  nextBlock,
  nextLabel,
  onOpenSchedule,
  goalTasks,
  goalTasksHiddenCount = 0,
  onTaskPress,
  onViewAllGoalTasks,
}: FocusNowCardProps) {
  if (loading) {
    return (
      // Labelled rather than left as three anonymous grey blocks: a screen
      // reader landing here mid-fetch otherwise announces nothing at all.
      <View
        style={styles.shellNeutral}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading what's happening now"
      >
        <View style={styles.loadingRow}>
          <Skeleton width={RING_SIZE} height={RING_SIZE} borderRadius={RING_SIZE / 2} />
          <View style={styles.loadingText}>
            <Skeleton width="45%" height={11} />
            <Skeleton width="80%" height={20} style={styles.loadingLine} />
            <Skeleton width="60%" height={12} style={styles.loadingLine} />
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellNeutral}>
        <ErrorState
          compact
          title="Can't reach your schedule"
          message="We couldn't check what's happening right now."
          onRetry={onRetry}
        />
      </View>
    );
  }

  if (activeBlock) {
    const pct = activeProgress ? Math.round(activeProgress.pct * 100) : 0;
    const remaining = activeProgress ? formatDuration(activeProgress.minutesLeft) : null;
    const hasGoalTasks = !!goalTasks && goalTasks.length > 0;

    return (
      // This used to be ONE PressableScale wrapping the whole card, with
      // onOpenSchedule as its only affordance. It's now a plain shell with
      // the hero (ring/title/chips/"Up next") as an inner PressableScale,
      // and the goal-tasks list below as separate, sibling PressableScales.
      // Pressable defaults `accessible` to true, which collapses its entire
      // subtree into ONE screen-reader-focusable node carrying only its own
      // accessibilityLabel — exactly what the hero wants (that's why
      // `nextUpFooter` is marked accessibilityElementsHidden below, its
      // text already folded into the label). But the goal-task rows need
      // the OPPOSITE: each one has to stay independently reachable and
      // speak its own task title, or VoiceOver/TalkBack users would lose
      // access to every task but the first three words baked into a shared
      // label. Splitting the outer Pressable in two is what makes both
      // true at once.
      <View style={styles.shellBrand}>
        <PressableScale
          onPress={onOpenSchedule}
          accessibilityRole="button"
          accessibilityLabel={`Focus now: ${activeBlock.title}, ${pct} percent elapsed${
            remaining ? `, ${remaining} left` : ""
          }${nextBlock ? `. Up next: ${nextBlock.title}${nextLabel ? `, ${nextLabel}` : ""}` : ""}. Open schedule.`}
        >
          <View style={styles.heroRow}>
            <ProgressRing
              progress={activeProgress?.pct ?? 0}
              size={RING_SIZE}
              strokeWidth={9}
              color={colors.primary}
              // A pale track on the warm card, not the grey border token —
              // grey-on-yellow muddies into an unintended third color.
              trackColor={colors.white}
            >
              <Text style={styles.ringValue}>{pct}%</Text>
              <Text style={styles.ringUnit}>done</Text>
            </ProgressRing>

            <View style={styles.heroBody}>
              <View style={styles.eyebrowRow}>
                <LiveDot />
                <Text style={styles.eyebrowBrand}>Focus now</Text>
              </View>

              <Text style={styles.heroTitle} numberOfLines={2}>
                {activeBlock.title}
              </Text>

              <View style={styles.metaRow}>
                <View style={styles.chipOnBrand}>
                  <Icon name="timer" size={12} color={colors.primaryForeground} />
                  <Text style={styles.chipOnBrandText}>
                    {formatTime12h(activeBlock.startTime)} – {formatTime12h(activeBlock.endTime)}
                  </Text>
                </View>
                {remaining ? (
                  <View style={styles.pillSolid}>
                    <Text style={styles.pillSolidText}>{remaining} left</Text>
                  </View>
                ) : null}
              </View>

              {activeBlock.goal?.title ? (
                <View style={styles.goalRow}>
                  <Icon name="goals" size={12} color={colors.primaryForeground} />
                  <Text style={styles.goalText} numberOfLines={1}>
                    {activeBlock.goal.title}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* The web bar shows the live block AND the "Up next" chip at the
              same time (focus-now-bar.tsx:76-80 computes `upcomingList`
              unconditionally, and :138-155 renders the chip beside the active
              block). Mobile previously suppressed "next" whenever anything was
              running, which hid it in exactly the moment a user asks "how much
              longer, and what then?". */}
          {nextBlock ? (
            <View style={styles.nextUpFooter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.nextUpLabel}>Up next</Text>
              <Text style={styles.nextUpTitle} numberOfLines={1}>
                {nextBlock.title}
              </Text>
              {nextLabel ? <Text style={styles.nextUpWhen}>{nextLabel}</Text> : null}
            </View>
          ) : null}
        </PressableScale>

        {/* Tasks under the goal this block belongs to — "what am I actually
            supposed to be doing right now", one layer more concrete than
            the block/goal titles above. Caller (app/(app)/index.tsx) only
            passes `goalTasks` when there's at least one incomplete match;
            this renders nothing rather than an empty state when there
            isn't, matching this card's own file-header note that its shell
            never disappears but its optional parts don't force themselves
            into view either. */}
        {hasGoalTasks ? (
          <View style={styles.goalTasksSection}>
            {goalTasks!.map((task) => (
              <PressableScale
                key={task.id}
                haptic={false}
                style={styles.goalTaskRow}
                onPress={() => onTaskPress?.(task)}
                accessibilityRole="button"
                accessibilityLabel={`${task.title}, open task`}
              >
                <View
                  style={[styles.goalTaskMarker, task.status === "DOING" && styles.goalTaskMarkerDoing]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
                <Text style={styles.goalTaskTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <Icon name="chevron" size={12} color={colors.primaryText} />
              </PressableScale>
            ))}
            {goalTasksHiddenCount > 0 ? (
              <PressableScale
                haptic={false}
                style={styles.goalTaskMoreRow}
                onPress={onViewAllGoalTasks}
                accessibilityRole="button"
                accessibilityLabel={`${goalTasksHiddenCount} more ${
                  goalTasksHiddenCount === 1 ? "task" : "tasks"
                } for this goal`}
              >
                <Text style={styles.goalTaskMoreText}>
                  +{goalTasksHiddenCount} more {goalTasksHiddenCount === 1 ? "task" : "tasks"}
                </Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (nextBlock) {
    return (
      <PressableScale
        style={styles.shellNeutral}
        onPress={onOpenSchedule}
        accessibilityRole="button"
        accessibilityLabel={`Up next: ${nextBlock.title}${nextLabel ? `, ${nextLabel}` : ""}. Open schedule.`}
      >
        <View style={styles.heroRow}>
          <View style={styles.nextTile}>
            <Icon name="schedule" size={26} color={colors.mutedForeground} />
          </View>

          <View style={styles.heroBody}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>Up next</Text>
              {nextLabel ? (
                <View style={styles.pillOutline}>
                  <Text style={styles.pillOutlineText}>{nextLabel}</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.heroTitle} numberOfLines={2}>
              {nextBlock.title}
            </Text>

            <View style={styles.metaRow}>
              <View style={styles.chip}>
                <Icon name="timer" size={12} color={colors.mutedForeground} />
                <Text style={styles.chipText}>
                  {formatTime12h(nextBlock.startTime)} – {formatTime12h(nextBlock.endTime)}
                </Text>
              </View>
              {nextBlock.category ? <Text style={styles.category}>{nextBlock.category}</Text> : null}
            </View>
          </View>
        </View>
      </PressableScale>
    );
  }

  return (
    <View style={styles.shellNeutral}>
      <SectionEmpty
        icon="schedule"
        emphasis="brand"
        // `compact` exists for exactly this case ("empty states that sit
        // inside an already-padded card") and this — the only such call
        // site — wasn't passing it, stacking the shell's 16pt onto the
        // block's own 24pt for 40pt of dead vertical space.
        compact
        headline="Your day is wide open"
        description="Block out the hours that matter and GoalSlot will keep you pointed at them."
        actionLabel="Plan your day"
        onAction={onOpenSchedule}
      />
    </View>
  );
}

/**
 * Expanding, fading ring behind a solid dot — the RN equivalent of the
 * `animate-ping` span the web bar renders next to its "Focus now" label
 * (focus-now-bar.tsx:104-107). UI-thread driven, same as Skeleton's pulse,
 * and cancelled on unmount so it can't tick against a torn-down tree.
 */
function LiveDot() {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 1.8 }],
    opacity: (1 - progress.value) * 0.55,
  }));

  return (
    <View style={styles.liveDotWrap}>
      <Animated.View style={[styles.liveDotRing, ringStyle]} />
      <View style={styles.liveDotCore} />
    </View>
  );
}

const styles = StyleSheet.create({
  // dw-time-web paints this strip with literal brand hexes
  // (`bg-[#fffbea]`, `border-[#f2cc0d]/30`, `text-[#8a7307]`). Mobile has no
  // alpha-blend helper and the theme owns every color in the app, so the
  // closest existing tokens stand in rather than re-hardcoding those values:
  // pale brand fill -> `primaryMuted`, brand hairline -> `primary`, warm ink
  // -> `primaryForeground` (which is exactly what the web uses for text
  // sitting on solid brand yellow, e.g. its "Xm left" chip).
  //
  // The fill was `warningMuted` (#FEF3DD). That is the theme's WARNING tint,
  // not its brand tint — it made the hero read as an alert, and it collided
  // with the same token doing real warning duty elsewhere. `primaryMuted`
  // (#FEFCE8, yellow-50) is the token foundation.ts documents for a
  // brand-accented container and is the near-exact match for web's #fffbea.
  shellBrand: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.lg,
    ...shadows.card,
  },
  shellNeutral: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  heroBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  nextTile: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  ringValue: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: colors.primaryForeground,
  },
  ringUnit: {
    ...typography.label,
    fontSize: 9,
    color: colors.primaryForeground,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  eyebrowBrand: {
    ...typography.label,
    color: colors.primaryForeground,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 24,
    color: colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.foreground,
  },
  chipOnBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipOnBrandText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.primaryForeground,
  },
  pillSolid: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillSolidText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.primaryForeground,
  },
  pillOutline: {
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pillOutlineText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.foreground,
  },
  // Separated by a rule rather than another chip row: "what's after this" is
  // a different question from "what is this", and the hairline is what stops
  // the two block titles from reading as one list.
  nextUpFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primary,
  },
  nextUpLabel: {
    ...typography.label,
    color: colors.primaryText,
  },
  nextUpTitle: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flexShrink: 1,
  },
  nextUpWhen: {
    ...typography.caption,
    fontSize: 11,
    color: colors.primaryText,
    marginLeft: "auto",
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  goalText: {
    ...typography.bodySmall,
    fontWeight: "500",
    color: colors.foreground,
    flexShrink: 1,
  },
  category: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  // Same hairline-under-`spacing.md` rule as `nextUpFooter`, so the card
  // reads as one stack of "sections" rather than the tasks looking bolted
  // onto the hero. Sits outside the hero's own PressableScale — see the
  // comment above this section's JSX for why.
  goalTasksSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primary,
    gap: spacing.xs,
  },
  // Deliberately more compact than TaskRow (this card is already the
  // densest thing on Today): no status pill, no metadata line, a plain dot
  // in place of TaskRow's 22px checkbox ring. Three of these plus the hero
  // above still has to fit above the fold.
  goalTaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingVertical: spacing.xs,
  },
  goalTaskMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryText,
    opacity: 0.4,
  },
  // "In progress" gets the same full-opacity treatment TaskRow gives its
  // DOING marker, so a task already underway reads as more "live" than one
  // still queued.
  goalTaskMarkerDoing: {
    opacity: 1,
  },
  goalTaskTitle: {
    ...typography.bodySmall,
    fontWeight: "500",
    color: colors.foreground,
    flex: 1,
  },
  goalTaskMoreRow: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  goalTaskMoreText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.primaryText,
  },
  liveDotWrap: {
    width: 10,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  liveDotRing: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  liveDotCore: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.primaryDark,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  loadingText: {
    flex: 1,
  },
  loadingLine: {
    marginTop: spacing.sm,
  },
});
