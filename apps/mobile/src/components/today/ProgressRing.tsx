// Circular progress meter for the Today screen's hero.
//
// dw-time-web renders block progress as a 2px bar pinned to the bottom of the
// focus strip (src/components/focus-now-bar.tsx:245-249). That reads fine in a
// full-width desktop ticker but it's the weakest possible signal on a phone,
// where the hero card IS the screen's focal point — a ring makes the primary
// metric visually dominant and leaves a natural slot in its middle for the
// number itself. Same data, same 0..1 fraction; only the mark changes.
//
// Built on react-native-svg + Reanimated's `useAnimatedProps` (both already
// dependencies) so the sweep animates on the UI thread, matching how
// Skeleton.tsx and the LiveDot already animate.

import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { motion } from "@/theme";
import { colors } from "@/theme/tokens";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface ProgressRingProps {
  /** 0..1. Values outside the range are clamped rather than overdrawing the arc. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** Rendered centered inside the ring — usually the number the ring depicts. */
  children?: ReactNode;
}

export function ProgressRing({
  progress,
  size = 88,
  strokeWidth = 8,
  color = colors.primary,
  trackColor = colors.border,
  children,
}: ProgressRingProps) {
  const reduceMotion = useReduceMotion();

  const target = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const sweep = useSharedValue(0);

  useEffect(() => {
    // Under reduce-motion the ring still shows the right value, it just
    // arrives there instantly — same opt-out the auth screens apply to their
    // FadeInDown entrances.
    if (reduceMotion) {
      sweep.value = target;
      return;
    }
    sweep.value = withTiming(target, {
      duration: motion.duration.slow,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(sweep);
  }, [target, reduceMotion, sweep]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - sweep.value),
  }));

  return (
    // The ring is a redundant restatement of text that's already in the card
    // (the "N% of block done" / "Xm left" copy), so it's hidden from
    // assistive tech rather than read out as an unlabelled graphic.
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* SVG arcs start at 3 o'clock; rotating the whole canvas is cheaper
          than re-deriving every path from a 12 o'clock origin. */}
      <Svg width={size} height={size} style={styles.canvas}>
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
          strokeDasharray={circumference}
          fill="none"
          animatedProps={animatedProps}
        />
      </Svg>
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  canvas: {
    transform: [{ rotate: "-90deg" }],
  },
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
