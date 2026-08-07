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

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: object;
}

const MIN_OPACITY = 0.35;
const MAX_OPACITY = 1;
const PULSE_DURATION_MS = 800;

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

export interface SkeletonListItemProps {
  /** Show a leading circular avatar-style skeleton (e.g. category dot, icon). Defaults to true. */
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
      {showLeading ? <Skeleton width={32} height={32} borderRadius={16} /> : null}
      <View style={styles.rowText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="40%" height={12} style={styles.rowSubtitle} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: "#E2E8F0",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  rowSubtitle: {
    marginTop: 2,
  },
});
