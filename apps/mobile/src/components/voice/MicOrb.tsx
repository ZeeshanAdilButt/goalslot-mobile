// The microphone control itself, and the only place any voice state is
// given a colour. Both mic surfaces render this — the raised centre button
// in the tab bar and the smaller one on the Time Tracker — so "listening"
// looks the same wherever the user meets it, which is what stops the second
// mic reading as a different feature.
//
// Every state is distinguished by more than colour: the glyph changes
// (mic / mic-off), so does the fill, so does the ring. A user who cannot
// tell brand yellow from destructive red still gets three different marks.
//
// Motion: a single expanding ring while listening, and nothing else. Under
// reduce-motion the ring is drawn static rather than removed — the visual
// weight of "the mic is open" has to survive, it just stops moving.

import { useEffect } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Icon } from "@/components/ui/Icon";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import type { VoiceCaptureStatus } from "@/hooks/useVoiceCapture";
import { colors, minTouchTarget, motion, radii, shadows } from "@/theme/tokens";

export interface MicOrbProps {
  status: VoiceCaptureStatus;
  onPress: () => void;
  /** Diameter. Never below `minTouchTarget`; the tab-bar variant is larger. */
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Overrides the generated label — the tab-bar mic announces itself as a tab. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /**
   * False renders the orb's face and halo only, as a plain `View` with no
   * `Pressable`/accessibility wrapper of its own — for a caller (see
   * `HoldToRecordMic`) that owns touch handling itself via a gesture
   * recognizer and would otherwise end up with two competing responders
   * fighting over the same touch. `onPress` is ignored in this mode.
   * Defaults to true, so every existing caller (TrackerVoiceButton, and any
   * plain tap-to-toggle mic) is unaffected.
   */
  interactive?: boolean;
}

interface StateVisual {
  fill: string;
  glyph: "mic" | "mic-off";
  glyphColor: string;
  ring: string | null;
}

/**
 * Yellow at rest is deliberate: this is the app's one brand-coloured
 * control, and a mic that looks like every other tab is a mic nobody
 * presses. Listening flips to near-black so the state reads as "recording"
 * rather than "highlighted", which is the convention every voice UI a user
 * has already met uses.
 */
const VISUALS: Record<VoiceCaptureStatus, StateVisual> = {
  idle: { fill: colors.primary, glyph: "mic", glyphColor: colors.primaryForeground, ring: null },
  listening: { fill: colors.ink, glyph: "mic", glyphColor: colors.primary, ring: colors.primary },
  processing: { fill: colors.foreground, glyph: "mic", glyphColor: colors.white, ring: null },
  success: { fill: colors.success, glyph: "mic", glyphColor: colors.successForeground, ring: null },
  error: { fill: colors.destructive, glyph: "mic", glyphColor: colors.destructiveForeground, ring: null },
  "permission-denied": {
    fill: colors.destructiveMuted,
    glyph: "mic-off",
    glyphColor: colors.destructive,
    ring: null,
  },
  unavailable: { fill: colors.secondary, glyph: "mic-off", glyphColor: colors.mutedForeground, ring: null },
};

const STATE_LABELS: Record<VoiceCaptureStatus, string> = {
  idle: "Speak a command",
  listening: "Listening. Tap to stop",
  processing: "Working on what you said",
  success: "Done",
  error: "That didn't work. Tap to try again",
  "permission-denied": "Microphone access is off",
  unavailable: "Voice isn't available on this device",
};

const PULSE_MS = 1400;

export function MicOrb({
  status,
  onPress,
  size = 56,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  interactive = true,
}: MicOrbProps) {
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0);
  const visual = VISUALS[status];
  const listening = status === "listening";

  useEffect(() => {
    if (!listening) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    if (reduceMotion) {
      // Held at the ring's midpoint rather than animated: the halo still
      // says "open mic", it just doesn't move.
      cancelAnimation(pulse);
      pulse.value = 0.5;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System }),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [listening, pulse, reduceMotion]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.45,
    transform: [{ scale: 1 + pulse.value * 0.55 }],
  }));

  const diameter = Math.max(minTouchTarget, size);
  const glyphSize = Math.round(diameter * 0.42);

  const face = (
    <>
      {visual.ring !== null ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            { borderRadius: diameter / 2, backgroundColor: visual.ring },
            haloStyle,
          ]}
        />
      ) : null}
      <View
        style={[
          styles.face,
          { borderRadius: diameter / 2, backgroundColor: visual.fill },
          status === "idle" && shadows.fab,
        ]}
      >
        <Icon name={visual.glyph} size={glyphSize} color={visual.glyphColor} />
      </View>
    </>
  );

  // The bare-View branch: no Pressable, no accessibility wiring of its own —
  // a wrapping gesture-driven caller (HoldToRecordMic) owns both, and giving
  // this a second responder underneath it is exactly the double-handling
  // that prop exists to avoid. See `interactive`'s doc comment.
  if (!interactive) {
    return <View style={[styles.root, { width: diameter, height: diameter, borderRadius: diameter / 2 }, style]}>{face}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? STATE_LABELS[status]}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: status === "listening" || status === "processing" }}
      // The halo overflows the button's own bounds, so the press area is
      // pinned to the circle rather than inferred from the layout box.
      hitSlop={8}
      style={({ pressed }) => [
        styles.root,
        { width: diameter, height: diameter, borderRadius: diameter / 2 },
        style,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {face}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    transform: [{ scale: motion.pressScale }],
  },
  halo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  face: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    // A hairline ring in the card colour separates the orb from whatever
    // surface it is docked over — without it the yellow fill bleeds into
    // the tab bar's own white.
    borderWidth: 3,
    borderColor: colors.card,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
});
