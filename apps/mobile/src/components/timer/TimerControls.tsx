// Transport controls for the Time Tracker.
//
// Shaped like a media player rather than a row of text buttons: one large
// round primary target in the middle (Start / Pause / Resume, whichever the
// current state calls for) with Stop set beside it. The primary sits at 88pt
// — roughly double the 44pt HIG minimum — because it's the control that gets
// pressed mid-task, often one-handed, and it stays in the same place across
// every state so the layout never jumps under a thumb that's already moving.
//
// Glyphs are drawn with react-native-svg instead of coming from
// @/components/ui/Icon: that set is a fixed 1:1 mapping of the web app's
// navigation/action icons (see its header comment) and has no transport
// vocabulary, and these render at 30-40pt where a hand-drawn shape stays
// perfectly crisp. No icon-library surface is added either way — Icon itself
// renders through react-native-svg.
//
// Haptics deliberately stay with the screen's own handlers (timer.tsx), so
// the feedback fires with the state change it belongs to rather than on
// every stray press of a disabled control.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";

import type { TimerStatus } from "@/lib/timer-store";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const PRIMARY_SIZE = 88;
const SECONDARY_SIZE = 56;
const PRESS_DURATION = 120;

function PlayGlyph({ size, color }: { size: number; color: string }) {
  // Nudged 8% right of centre — a triangle centred on its bounding box reads
  // as sitting left inside a circle.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 5.5 L19 12 L9 18.5 Z" fill={color} strokeLinejoin="round" strokeWidth={2} stroke={color} />
    </Svg>
  );
}

function PauseGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="6.5" y="5" width="4" height="14" rx="1.6" fill={color} />
      <Rect x="13.5" y="5" width="4" height="14" rx="1.6" fill={color} />
    </Svg>
  );
}

function StopGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill={color} />
    </Svg>
  );
}

interface TransportButtonProps {
  size: number;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  backgroundColor: string;
  borderColor?: string;
  children: ReactNode;
}

/** Round target with a spring-free scale-down on press — cheap, and it makes a big flat circle feel physical. */
function TransportButton({
  size,
  onPress,
  accessibilityLabel,
  disabled = false,
  backgroundColor,
  borderColor,
  children,
}: TransportButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.92, { duration: PRESS_DURATION });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: PRESS_DURATION });
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      // Keeps the tappable area at least 44pt even for the smaller circle.
      hitSlop={Math.max(0, (minTouchTarget - size) / 2)}
    >
      <Animated.View
        style={[
          styles.transportButton,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor,
            borderColor: borderColor ?? "transparent",
            borderWidth: borderColor ? 1 : 0,
          },
          disabled && styles.disabled,
          animatedStyle,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

export interface TimerControlsProps {
  status: TimerStatus;
  /** False while idle with nothing picked — the primary stays visible but inert. */
  canStart: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function TimerControls({ status, canStart, onStart, onPause, onResume, onStop }: TimerControlsProps) {
  const isRunning = status === "running";
  const isIdle = status === "idle";

  const primary = isRunning
    ? { label: "Pause", accessibilityLabel: "Pause timer", onPress: onPause, disabled: false }
    : isIdle
      ? { label: "Start", accessibilityLabel: "Start timer", onPress: onStart, disabled: !canStart }
      : { label: "Resume", accessibilityLabel: "Resume timer", onPress: onResume, disabled: false };

  return (
    <View style={styles.row}>
      {/* Empty counterweight so the primary stays optically centred whether
          or not Stop is on screen — no shifting target between states. */}
      <View style={styles.side} />

      <View style={styles.slot}>
        <TransportButton
          size={PRIMARY_SIZE}
          onPress={primary.onPress}
          accessibilityLabel={primary.accessibilityLabel}
          disabled={primary.disabled}
          backgroundColor={colors.primary}
        >
          {isRunning ? (
            <PauseGlyph size={40} color={colors.primaryForeground} />
          ) : (
            // Dark glyph on brand yellow — never white, the contrast fails.
            <PlayGlyph size={40} color={colors.primaryForeground} />
          )}
        </TransportButton>
        <Text style={styles.slotLabel}>{primary.label}</Text>
      </View>

      <View style={styles.side}>
        {!isIdle ? (
          <View style={styles.slot}>
            <TransportButton
              size={SECONDARY_SIZE}
              onPress={onStop}
              accessibilityLabel="Stop timer and log entry"
              backgroundColor={colors.destructiveMuted}
              borderColor={colors.border}
            >
              <StopGlyph size={24} color={colors.destructive} />
            </TransportButton>
            <Text style={styles.slotLabel}>Stop</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginTop: spacing.sm,
  },
  side: {
    width: SECONDARY_SIZE + spacing.sm,
    alignItems: "center",
  },
  slot: {
    alignItems: "center",
    gap: spacing.sm,
  },
  slotLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  transportButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    ...shadows.fab,
  },
  disabled: {
    opacity: 0.35,
  },
});
