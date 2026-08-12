// The centre control in the tab bar: a raised circle that breaks the bar's
// top line, sitting where the third of five tabs would be.
//
// It is a real registered route (app/(app)/voice.tsx), not a button that
// opens a sheet over whatever screen you were on. That costs a navigation
// but buys three things worth more: a screen reader announces it as a tab
// among tabs instead of an unlabelled control floating over the UI, the
// back gesture behaves the way it does everywhere else, and the assistant
// gets a full viewport for the transcript and the confirmation cards rather
// than a sheet fighting the keyboard.
//
// This component only navigates. The live microphone state lives on the
// screen it opens — a 44pt circle cannot usefully render seven states, and
// the moment you press this the screen that can is filling the viewport.

import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { colors, iconSize, minTouchTarget, motion, radii, shadows, spacing, typography } from "@/theme/tokens";

/**
 * Structurally typed against what React Navigation hands a `tabBarButton`,
 * rather than importing `BottomTabBarButtonProps` from
 * @react-navigation/bottom-tabs — that package is a transitive dependency of
 * expo-router, not a declared one, and reaching into it directly is exactly
 * the import pnpm's strict layout is right to break later.
 */
export interface VoiceTabButtonProps {
  onPress?: ((event: GestureResponderEvent) => void) | null;
  accessibilityState?: { selected?: boolean };
}

/** Diameter. Larger than the 44pt floor because this is the bar's one hero control. */
const ORB_SIZE = 58;

/**
 * How far the orb sits above the bar's top edge. Two thirds of it clears the
 * line, which is enough to read as "raised" without the icon drifting off
 * the touch target the row provides.
 */
const LIFT = 20;

export function VoiceTabButton({ onPress, accessibilityState }: VoiceTabButtonProps) {
  const selected = accessibilityState?.selected === true;

  return (
    <Pressable
      onPress={(event) => onPress?.(event)}
      accessibilityRole="tab"
      accessibilityLabel="Voice assistant"
      accessibilityHint="Speak a command, such as start tracking my deen goal"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.slot, pressed && styles.pressed]}
    >
      <View style={[styles.orb, selected && styles.orbSelected]}>
        <Icon
          name="mic"
          size={iconSize.lg}
          color={selected ? colors.primary : colors.primaryForeground}
        />
      </View>
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
        Voice
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: minTouchTarget,
    // The orb is pulled up out of the row; this keeps the "Voice" caption on
    // the same baseline as every other tab's label instead of riding up with
    // it.
    paddingTop: spacing.xxs,
  },
  pressed: {
    transform: [{ scale: motion.pressScale }],
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: radii.pill,
    marginTop: -LIFT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    // A ring in the bar's own colour is what makes the circle read as
    // punched through the bar rather than pasted on top of it.
    borderWidth: 4,
    borderColor: colors.card,
    ...shadows.fab,
  },
  orbSelected: {
    // Inverted while focused, matching how the mic itself goes dark the
    // moment it opens (see MicOrb) — same idea, same colours, so arriving on
    // the screen isn't a visual jump.
    backgroundColor: colors.ink,
  },
  label: {
    ...typography.label,
    textTransform: "none",
    letterSpacing: 0,
    fontSize: 11,
    fontWeight: "600",
    color: colors.mutedForeground,
    // The tab bar's own labels sit at the bottom of the row; this one has to
    // be nudged to meet them because its icon was lifted out of the flow.
    marginTop: Platform.select({ ios: spacing.xxs, default: 0 }),
  },
  labelSelected: {
    color: colors.primaryDark,
  },
});
