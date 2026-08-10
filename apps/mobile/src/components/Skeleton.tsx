// Loading-placeholder primitive every list-heavy screen (Today, Schedule,
// Tasks, Notes) reaches for.
//
// Web fakes loading with Tailwind's `animate-pulse` (skeleton.tsx —
// `animate-pulse rounded-md bg-zinc-100`), which fades the whole block in and
// out. That reads as a flashing rectangle on a phone, where the placeholder
// fills much more of the viewport than it does in a desktop column. This
// version keeps web's zinc-100 fill but animates a highlight SWEEPING across
// it instead: the block stays put, and the motion travels, which reads as
// "content is arriving" rather than "something is blinking".
//
// Both the sweep and its cleanup run on the UI thread via Reanimated, so the
// placeholder stays smooth while the JS thread is busy fetching and parsing
// the very data the skeleton is standing in for.

import { useEffect, useId, useState } from "react";
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { colors, radii, shadows, spacing } from "@/theme/tokens";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: object;
}

// One full traverse per 1.4s, linear. Deliberately slower than a "loading
// bar" and with no easing at the turnaround, because a sweep that
// accelerates draws the eye to the placeholder instead of past it.
const SWEEP_DURATION_MS = 1400;
// The highlight is 60% of the block's width, so on a short block (a 40%-width
// subtitle line) the sweep is still visible as a moving band rather than
// covering the whole thing at once.
const HIGHLIGHT_RATIO = 0.6;

export function Skeleton({ width = "100%", height = 16, borderRadius = radii.chip, style }: SkeletonProps) {
  // The sweep has to travel a pixel distance, and `width` may be a percentage
  // string, so the real width comes from layout rather than from the prop.
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const progress = useSharedValue(0);

  // react-native-svg resolves `url(#id)` per rendered tree; a shared literal
  // id makes every skeleton on screen point at whichever gradient mounted
  // last. `useId` gives each instance its own.
  const gradientId = `skeleton-sweep-${useId()}`;

  useEffect(() => {
    if (measuredWidth === 0) {
      return;
    }

    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: SWEEP_DURATION_MS, easing: Easing.linear }),
      -1, // repeat forever
      false, // restart from the left each pass rather than sweeping back
    );

    // A Reanimated loop tied to a shared value keeps running against a
    // torn-down component unless cancelled — this stops it when the skeleton
    // unmounts (i.e. when the real content lands).
    return () => {
      cancelAnimation(progress);
    };
  }, [measuredWidth, progress]);

  const highlightWidth = Math.max(measuredWidth * HIGHLIGHT_RATIO, 1);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      {
        // Travels from fully off the left edge to fully off the right edge.
        translateX: -highlightWidth + progress.value * (measuredWidth + highlightWidth),
      },
    ],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth !== measuredWidth) {
      setMeasuredWidth(nextWidth);
    }
  };

  return (
    <View
      style={[styles.base, { width, height, borderRadius }, style]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {measuredWidth > 0 ? (
        <Animated.View style={[styles.sweep, { width: highlightWidth }, sweepStyle]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.white} stopOpacity={0} />
                <Stop offset="0.5" stopColor={colors.white} stopOpacity={0.85} />
                <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
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
      {showLeading ? (
        <Skeleton width={LEADING_DOT_SIZE} height={LEADING_DOT_SIZE} borderRadius={LEADING_DOT_SIZE / 2} />
      ) : null}
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
    backgroundColor: colors.skeleton, // web skeleton.tsx `bg-zinc-100`
    overflow: "hidden", // clips the sweep to the placeholder's own corners
  },
  sweep: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
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
    borderRadius: radii.card,
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
