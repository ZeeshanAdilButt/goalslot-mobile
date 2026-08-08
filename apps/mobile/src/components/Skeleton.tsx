// Loading-placeholder primitive every upcoming list-heavy screen (Today,
// Schedule, Tasks) reaches for. The pulse runs entirely on the UI thread via
// Reanimated's `useAnimatedStyle` + `withRepeat`/`withTiming` — no JS-thread
// `Animated.timing` loop — so it stays smooth even while the JS thread is
// busy fetching/parsing the data the skeleton is standing in for. Getting
// this one component right once (UI-thread animation, cancels cleanly on
// unmount) means every screen's loading state inherits the same behavior
// instead of five slightly-different reimplementations.

import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors, radii, shadows, spacing } from "@/theme/tokens";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: object;
}

// Mirrors dw-time-web's `animate-pulse` cadence (Tailwind default: 2s,
// ease-in-out, alternating 1 <-> ~0.5) rather than a snappier/JS-native
// feel, so the loading moment reads the same on both platforms.
const MIN_OPACITY = 0.45;
const MAX_OPACITY = 1;
const PULSE_DURATION_MS = 1000;

export function Skeleton({ width = "100%", height = 16, borderRadius = 6, style }: SkeletonProps) {
  const opacity = useSharedValue(MIN_OPACITY);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(MAX_OPACITY, { duration: PULSE_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1, // repeat forever
      true, // reverse each cycle, so it pulses rather than snapping back
    );

    // Reanimated animations tied to a shared value keep running against a
    // torn-down component unless explicitly cancelled — this stops the loop
    // when the skeleton unmounts (e.g. real content replaces it).
    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[styles.base, { width, height, borderRadius }, animatedStyle, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

// Real leading markers on Today/Schedule/Goals rows are small 12px category
// dots (see e.g. goals.tsx's `colorDot` / index.tsx's `colorDot`), not
// avatar-sized circles — sized to match so the skeleton doesn't visibly
// "pop" into a smaller dot once real content lands.
const LEADING_DOT_SIZE = 12;

export interface SkeletonListItemProps {
  /** Show a leading circular dot skeleton (matches a category/status dot). Defaults to true. */
  showLeading?: boolean;
}

/**
 * A composed convenience for the common "row with a leading dot + a title
 * line + a subtitle line" shape that Today/Schedule/Tasks all render lists
 * of. Not meant to match every screen's exact layout — screens with a
 * meaningfully different row shape should compose `Skeleton` directly
 * instead of forcing this one to grow more props.
 */
export function SkeletonListItem({ showLeading = true }: SkeletonListItemProps) {
  return (
    <View style={styles.row}>
      {showLeading ? <Skeleton width={LEADING_DOT_SIZE} height={LEADING_DOT_SIZE} borderRadius={LEADING_DOT_SIZE / 2} /> : null}
      <View style={styles.rowText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="40%" height={12} style={styles.rowSubtitle} />
      </View>
    </View>
  );
}

/**
 * A composed convenience for the elevated-card row shape goals.tsx renders
 * (bordered/shadowed card, small leading dot, title + category line, then a
 * progress-bar track + label) — SkeletonListItem's plain-row shape reads as
 * noticeably thinner than that card chrome, so this gives screens with that
 * shape (goal lists today, anything similar later) a matching placeholder
 * instead of forcing SkeletonListItem to grow a variant prop.
 */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton width={LEADING_DOT_SIZE} height={LEADING_DOT_SIZE} borderRadius={LEADING_DOT_SIZE / 2} />
      <View style={styles.cardBody}>
        <Skeleton width="55%" height={15} />
        <Skeleton width="30%" height={12} style={styles.rowSubtitle} />
        <Skeleton width="100%" height={6} borderRadius={3} style={styles.cardProgressTrack} />
        <Skeleton width="35%" height={11} style={styles.rowSubtitle} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowSubtitle: {
    marginTop: spacing.xxs,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  cardProgressTrack: {
    marginTop: spacing.xxs,
  },
});
