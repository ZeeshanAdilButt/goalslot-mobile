// Circular goal-progress ring with the percentage in the middle.
//
// The web shows goal progress as a flat bar plus a big number beside it
// (dw-time-web/src/features/goals/components/goal-item.tsx:130-146: a
// `h-1.5 rounded-full bg-zinc-100` track, a `bg-[#f2cc0d]` fill animated on
// width, and `text-[16px] font-bold tabular-nums` for the percent). On a
// phone that horizontal layout competes with the title for the same scarce
// width, so the same two facts — fill proportion and the exact number — are
// folded into one compact circular dial that anchors the left edge of every
// goal row. The arc color is the GOAL's color (the web already treats
// goal.color as the row's identity via its left border), with brand yellow
// as the fallback so a colorless goal still reads on-brand.
//
// The sweep animates from empty on mount, matching the web's
// `transition-[width] duration-500` on the bar fill.

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, type CircleProps } from "react-native-svg";

import { colors, typography } from "@/theme/tokens";

import { withAlpha } from "./color";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SWEEP_DURATION_MS = 700;

export interface ProgressRingProps {
  /** 0-100. Values outside the range are clamped, matching the web's `Math.min(100, ...)`. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Arc color — pass the entity's own color. Defaults to brand yellow. */
  color?: string;
  /** Screen-reader text. Defaults to "<n> percent complete". */
  accessibilityLabel?: string;
}

export function ProgressRing({
  progress,
  size = 58,
  strokeWidth = 5,
  color = colors.primary,
  accessibilityLabel,
}: ProgressRingProps) {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const sweep = useSharedValue(0);

  useEffect(() => {
    sweep.value = withTiming(value / 100, {
      duration: SWEEP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [sweep, value]);

  const animatedProps = useAnimatedProps<CircleProps>(() => ({
    strokeDashoffset: circumference * (1 - sweep.value),
  }));

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? `${value} percent complete`}
      accessibilityValue={{ min: 0, max: 100, now: value }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          // Track tinted from the same entity color rather than flat zinc, so
          // a 0%-progress goal still reads as a deliberate dial.
          stroke={withAlpha(color, 0.14, colors.secondary)}
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
          // 12 o'clock start, clockwise — the direction people read a dial.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.suffix}>%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    // `tabular-nums` on web — RN has no numeric-variant control, so the ring
    // is sized generously enough that 7 -> 100 doesn't visibly reflow.
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
    letterSpacing: -0.4,
  },
  suffix: {
    ...typography.label,
    color: colors.mutedForeground,
    marginLeft: 1,
    marginTop: 3,
  },
});
