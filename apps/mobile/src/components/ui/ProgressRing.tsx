// Circular progress primitive. There is no web equivalent to port — the web
// app shows goal progress as a horizontal bar because a dashboard row has
// horizontal space to spare. A phone row does not, and a ring reads as a
// completion state at a glance where a 6px bar reads as a divider, so this
// is a deliberate mobile-only form for the same data.
//
// Built on react-native-svg (already a dependency, via GoalSlotLogo) rather
// than a masked-View trick, so the arc stays crisp at any size, and animated
// through Reanimated's `useAnimatedProps` so the sweep runs on the UI thread
// — a list of goal rings must not stutter while the list is scrolling.
//
// Colour defaults to brand yellow because progress is the one place the
// product's accent belongs: it's the "your effort" colour on web's timer and
// journal glows (globals.css `.timer-glow`).

import type { ReactNode } from "react";
import { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { colors, motion, typography } from "@/theme/tokens";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ProgressRingProps {
  /** 0-1. Values outside that range are clamped, so callers can pass a raw ratio. */
  progress: number;
  /** Outer diameter in px. */
  size?: number;
  strokeWidth?: number;
  /** Arc colour. Defaults to brand yellow. */
  color?: string;
  /** Unfilled remainder colour. */
  trackColor?: string;
  /** Rendered dead-centre. Defaults to the rounded percentage when `showValue` is on. */
  children?: ReactNode;
  showValue?: boolean;
  /** Skip the sweep animation — for rings rendered inside a long list where 40 simultaneous sweeps would be noise. */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function ProgressRing({
  progress,
  size = 56,
  strokeWidth = 6,
  color = colors.primary,
  trackColor = colors.secondary,
  children,
  showValue = false,
  animated = true,
  style,
  accessibilityLabel,
}: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Drawn as a dash the length of the full circle, offset back by the unfilled
  // remainder — the standard SVG arc technique, and the only one that lets a
  // single element animate from empty to full without path recalculation.
  const offset = useSharedValue(circumference);

  useEffect(() => {
    const target = circumference * (1 - clamped);
    offset.value = animated
      ? withTiming(target, { duration: motion.duration.slow, easing: Easing.out(Easing.cubic) })
      : target;
  }, [animated, circumference, clamped, offset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));

  return (
    <View
      style={[styles.container, { width: size, height: size }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          // Start the sweep at 12 o'clock instead of 3 o'clock, which is
          // where SVG's angle 0 sits.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children || showValue ? (
        <View style={styles.center} pointerEvents="none">
          {children ?? <Text style={styles.value}>{Math.round(clamped * 100)}%</Text>}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    // Written out rather than via `StyleSheet.absoluteFillObject`, which this
    // React Native version doesn't declare on the StyleSheet type.
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    ...typography.caption,
    // The percentage inside a ring is data, not a label — drop the uppercase
    // transform the `caption` role carries for chip text.
    textTransform: "none",
    color: colors.foreground,
  },
});
