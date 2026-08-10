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

import { formatDuration, formatTime12h, type ScheduleBlock } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { PressableScale } from "@/components/today/PressableScale";
import { ProgressRing } from "@/components/today/ProgressRing";
import { SectionEmpty } from "@/components/today/SectionEmpty";
import { Skeleton } from "@/components/Skeleton";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const RING_SIZE = 86;

export interface FocusNowCardProps {
  loading: boolean;
  activeBlock: ScheduleBlock | null;
  /** Elapsed fraction + minutes remaining for `activeBlock`. Derived by the caller. */
  activeProgress: { pct: number; minutesLeft: number } | null;
  nextBlock: ScheduleBlock | null;
  /** Human countdown for `nextBlock` ("in 25m"), phrased the way the web bar phrases it. */
  nextLabel: string | null;
  /** Opens the schedule — the web bar's "View Schedule" link. */
  onOpenSchedule: () => void;
}

export function FocusNowCard({
  loading,
  activeBlock,
  activeProgress,
  nextBlock,
  nextLabel,
  onOpenSchedule,
}: FocusNowCardProps) {
  if (loading) {
    return (
      <View style={styles.shellNeutral}>
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

  if (activeBlock) {
    const pct = activeProgress ? Math.round(activeProgress.pct * 100) : 0;
    const remaining = activeProgress ? formatDuration(activeProgress.minutesLeft) : null;

    return (
      <PressableScale
        style={styles.shellBrand}
        onPress={onOpenSchedule}
        accessibilityRole="button"
        accessibilityLabel={`Focus now: ${activeBlock.title}, ${pct} percent elapsed${
          remaining ? `, ${remaining} left` : ""
        }. Open schedule.`}
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
      </PressableScale>
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
  // pale warm fill -> `warningMuted`, brand hairline -> `primary`, warm ink
  // -> `primaryForeground` (which is exactly what the web uses for text
  // sitting on solid brand yellow, e.g. its "Xm left" chip).
  shellBrand: {
    backgroundColor: colors.warningMuted,
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
