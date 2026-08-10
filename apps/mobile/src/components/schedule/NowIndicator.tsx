// The live "current time" line drawn across today's timeline.
//
// The web has no equivalent — its grid shows all seven days at once, so "now"
// is surfaced as a separate banner above the canvas (dw-time-web/src/features/
// schedule/components/schedule-page.tsx's `activeBlock` call-out, which ticks
// every 30s). Mobile shows one day, so the same information belongs ON the
// axis: a line at the current minute is what makes the day read as in-progress
// rather than as a static plan.
//
// Brand restraint: the hairline uses `primaryDark` rather than `primary`,
// because a 2px #F2CC0D rule over an off-white canvas is close to invisible,
// and the time bubble carries dark ink on yellow (never white).

import { memo, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { formatTime12h, minutesToTime } from "@goalslot/shared";

import { colors, radii, spacing, typography } from "@/theme/tokens";

import { GUTTER_WIDTH } from "./layout";

const PULSE_MS = 1400;
const ROW_HEIGHT = spacing.xl;

export interface NowIndicatorProps {
  /** Y offset of the current minute within the timeline canvas. */
  top: number;
  minutes: number;
}

export const NowIndicator = memo(function NowIndicator({ top, minutes }: NowIndicatorProps) {
  // Slow breathing halo on the knob — the web's own "active now" affordance is
  // an `animate-ping` ring (schedule-page.tsx), so the vocabulary carries over.
  // Runs on the UI thread via Reanimated, so it survives a busy JS thread.
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.5 - pulse.value * 0.4,
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));

  return (
    <View
      // Centred on the current minute, not hung below it.
      style={[styles.container, { top: top - ROW_HEIGHT / 2 }]}
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={`Current time, ${formatTime12h(minutesToTime(minutes))}`}
    >
      <View style={styles.bubble}>
        {/* The gutter is only as wide as an hour label, so the bubble shrinks
            its own type rather than wrapping or clipping at large font scales. */}
        <Text style={styles.bubbleText} numberOfLines={1} adjustsFontSizeToFit>
          {formatTime12h(minutesToTime(minutes))}
        </Text>
      </View>
      <View style={styles.knobWrap}>
        <Animated.View style={[styles.halo, haloStyle]} />
        <View style={styles.knob} />
      </View>
      <View style={styles.line} />
    </View>
  );
});

const KNOB_SIZE = spacing.sm;
const LINE_HEIGHT = 2;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: spacing.sm,
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
  },
  bubble: {
    width: GUTTER_WIDTH - spacing.sm,
    alignItems: "center",
    paddingVertical: spacing.xxs,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  bubbleText: {
    ...typography.label,
    letterSpacing: 0,
    color: colors.primaryForeground,
  },
  knobWrap: {
    width: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.primaryDark,
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.primaryDark,
  },
  line: {
    flex: 1,
    height: LINE_HEIGHT,
    borderRadius: radii.full,
    backgroundColor: colors.primaryDark,
  },
});
