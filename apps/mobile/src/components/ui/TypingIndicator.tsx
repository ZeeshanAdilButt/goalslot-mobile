// A small wave of bouncing dots standing in for "the assistant is working on
// a reply" — used wherever Coach or Voice would otherwise show a bare
// "Thinking…" string. Three static dots read as frozen the moment a reply
// takes more than a second or two; a staggered bounce reads as a system
// actively doing something, the same signal chat apps use for "typing…".
//
// Coach's chat bubble already had a three-dot typing indicator (static
// "●●●" text) — this replaces it and voice.tsx's plain "Thinking…" string
// with one shared, animated component so both screens read the same way.
//
// Built with Reanimated rather than an actual GIF: there's no asset
// pipeline for shipping a GIF in this app, and a hand-built loop is both
// lighter-weight and themeable (it takes a `color` prop) than a bundled
// image would be. Follows the same Reanimated + useReduceMotion gating as
// timer.tsx's `PulsingDot` — the one continuous, indefinitely-repeating
// animation on a screen is exactly what Reduce Motion exists to switch off,
// so each dot collapses to a static circle (not to nothing: "still waiting"
// has to survive with motion off, only the bounce doesn't) when it's on.

import { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, spacing } from "@/theme/tokens";

const DOT_COUNT = 3;
/** How far each dot rises off its baseline at the top of its bounce. */
const BOUNCE_DISTANCE = 4;
/** One full up-and-back cycle, before stagger. Quick enough to read as
 * "alive" without drawing more attention than the reply it's standing in
 * for. */
const CYCLE_DURATION_MS = 600;
/** Delay between one dot starting its cycle and the next — small enough that
 * the three read as one wave, not three independent blinkers. */
const STAGGER_MS = 120;

interface DotProps {
  delay: number;
  reduceMotion: boolean;
  color: string;
  size: number;
}

function Dot({ delay, reduceMotion, color, size }: DotProps) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(translateY);
      // Sits at the baseline, not mid-bounce — with motion off this is a
      // static "waiting" dot, not a paused animation frame.
      translateY.value = 0;
      return;
    }
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-BOUNCE_DISTANCE, { duration: CYCLE_DURATION_MS / 2, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: CYCLE_DURATION_MS / 2, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, // repeat forever
        false, // always rise-then-fall in that order, never reverse mid-cycle
      ),
    );
    return () => cancelAnimation(translateY);
  }, [delay, reduceMotion, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

export interface TypingIndicatorProps {
  /** Merged onto the wrapping row — e.g. to center it inside a status line. */
  style?: ViewStyle;
  /** Dot fill color. Defaults to the same muted tone the old "Thinking…" text used. */
  color?: string;
  /** Dot diameter in px. */
  size?: number;
}

/**
 * Purely decorative — callers that need the waiting state announced to a
 * screen reader put an `accessibilityLabel` (e.g. "Coach is typing") on
 * their own wrapping element, same as before this component existed; this
 * one hides itself from the accessibility tree so VoiceOver/TalkBack don't
 * also try to read three unlabeled dots.
 */
export function TypingIndicator({ style, color = colors.mutedForeground, size = 7 }: TypingIndicatorProps) {
  const reduceMotion = useReduceMotion();

  return (
    <View style={[styles.row, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <Dot key={index} delay={index * STAGGER_MS} reduceMotion={reduceMotion} color={color} size={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
});
