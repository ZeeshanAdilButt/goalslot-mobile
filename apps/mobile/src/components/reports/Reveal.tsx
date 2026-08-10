// Staggered fade-and-rise wrapper for the Reports cards.
//
// Hand-rolled from shared values rather than Reanimated's `entering={...}`
// layout animations on purpose: entering animations re-run on every list
// re-order and are awkward to disable per-instance, whereas this needs to
// play exactly once per mount and go completely flat under Reduce Motion.
//
// Delays are the caller's business — see the screen for the ladder. Keep the
// total stagger inside ~300ms: past that a dashboard feels like it's loading
// rather than arriving.

import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useEffect } from "react";

const DURATION = 260;
const RISE = 10;

export interface RevealProps {
  children: ReactNode;
  /** Milliseconds before this element starts animating in. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function Reveal({ children, delay = 0, style }: RevealProps) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delay, withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }));
  }, [delay, reduceMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
