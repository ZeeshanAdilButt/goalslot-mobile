// Press primitive for the Today screen's tappable cards.
//
// The web app signals "this card is clickable" with hover affordances it can
// rely on having a mouse for — `group-hover:translate-x-1` on the arrow in
// src/features/dashboard/components/dashboard-schedule-cta.tsx, the
// `hover:shadow` on src/components/ui/glass-card.tsx. Touch has no hover, so
// the equivalent affordance has to happen on press: a spring scale-down plus
// a light haptic. Without it a full-bleed card gives no feedback at all
// between tap and navigation, which is what makes a screen feel like a web
// page in a WebView rather than a native app.
//
// Spring (not timing) because the release should overshoot slightly — that's
// the detail that reads as "physical" rather than "animated".

import { forwardRef, useCallback, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
} from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { hapticLight } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESSED_SCALE = 0.97;
// Critically-ish damped: settles in ~180ms with a barely-perceptible
// overshoot. Anything bouncier reads as a toy on a productivity screen.
const SPRING = { damping: 18, stiffness: 320, mass: 0.6 } as const;

export interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Light impact on press. On by default because every current caller is a
   * navigation/primary action; opt out for anything that already fires its
   * own haptic downstream (e.g. QuickAddSheet does it from `onChange`).
   */
  haptic?: boolean;
}

export const PressableScale = forwardRef<
  React.ComponentRef<typeof Pressable>,
  PressableScaleProps
>(function PressableScale({ children, style, haptic = true, onPress, onPressIn, onPressOut, ...rest }, ref) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);

  const handlePressIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (event) => {
      if (!reduceMotion) scale.value = withSpring(PRESSED_SCALE, SPRING);
      onPressIn?.(event);
    },
    [reduceMotion, scale, onPressIn],
  );

  const handlePressOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (event) => {
      if (!reduceMotion) scale.value = withSpring(1, SPRING);
      onPressOut?.(event);
    },
    [reduceMotion, scale, onPressOut],
  );

  const handlePress = useCallback<NonNullable<PressableProps["onPress"]>>(
    (event) => {
      if (haptic) hapticLight();
      onPress?.(event);
    },
    [haptic, onPress],
  );

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      ref={ref}
      style={[style, animatedStyle as AnimatedStyle<ViewStyle>]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
});
