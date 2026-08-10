// The card surface every list row on Goals/Tasks/Categories sits in.
//
// Mirrors dw-time-web/src/components/ui/glass-card.tsx (rounded-xl, hairline
// border, soft shadow) plus the two places the web hangs an entity color off
// the card's LEFT EDGE rather than colouring the whole surface:
//   - features/goals/components/goal-item.tsx:54 — `border-l-[5px]` with
//     `style={{ borderLeftColor: goal.color }}`
//   - features/tasks/components/task-list-item/task-list-item.tsx:47 —
//     `border-l-4` with the status accent from task-status-styles.ts
// That's the restraint rule for this screen family: category/goal colors
// carry the variety on a 5px stripe, the card chrome itself stays neutral.
//
// Two things are mobile-only, because the web's equivalents are hover
// affordances that don't exist on touch: a spring press-scale (replaces
// `hover:-translate-y-0.5`) and a staggered entrance (`index`), which is the
// native idiom for "this list just loaded". Entrance uses Reanimated's
// declarative `entering` prop — an ENTERING animation, not a layout
// animation, so it stays safe under FlashList cell recycling.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { colors, radii, shadows, spacing } from "@/theme/tokens";

/** Cap the stagger so row 40 doesn't animate in three seconds late. */
const MAX_STAGGER_INDEX = 8;
const STAGGER_STEP_MS = 45;
const ENTER_DURATION_MS = 260;

const PRESS_SCALE = 0.977;
const SPRING = { damping: 18, stiffness: 260, mass: 0.6 } as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ListCardProps {
  children: ReactNode;
  /** Entity color painted on the left stripe (goal.color, category.color, status accent). */
  accentColor?: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Completed/inactive rows recede instead of disappearing (web: `opacity-90` on DONE tasks). */
  dimmed?: boolean;
  /** Position in the list — drives the entrance stagger only. */
  index?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  /** Padding-level overrides for rows that need a tighter body. */
  contentStyle?: StyleProp<ViewStyle>;
}

export function ListCard({
  children,
  accentColor,
  onPress,
  onLongPress,
  dimmed = false,
  index = 0,
  accessibilityLabel,
  accessibilityHint,
  style,
  contentStyle,
}: ListCardProps) {
  const pressed = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pressed.value * (PRESS_SCALE - 1) }],
  }));

  const entering = FadeInDown.duration(ENTER_DURATION_MS)
    .delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS)
    .springify()
    .damping(20);

  const body = (
    <>
      {accentColor ? <View style={[styles.accent, { backgroundColor: accentColor }]} /> : null}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </>
  );

  if (!onPress && !onLongPress) {
    return (
      <Animated.View entering={entering} style={[styles.card, dimmed && styles.cardDimmed, style]}>
        {body}
      </Animated.View>
    );
  }

  return (
    <AnimatedPressable
      entering={entering}
      style={[styles.card, dimmed && styles.cardDimmed, pressStyle, style]}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressed.value = withSpring(1, SPRING);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, SPRING);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {body}
    </AnimatedPressable>
  );
}

const ACCENT_WIDTH = 5; // goal-item.tsx `border-l-[5px]`

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    // Clips the accent stripe to the card's rounded corners; iOS still
    // paints the shadow outside the clip, so elevation survives.
    overflow: "hidden",
    ...shadows.card,
  },
  cardDimmed: {
    opacity: 0.72,
  },
  accent: {
    width: ACCENT_WIDTH,
    alignSelf: "stretch",
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
