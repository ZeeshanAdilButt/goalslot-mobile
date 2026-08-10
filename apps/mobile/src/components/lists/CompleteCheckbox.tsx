// Spring-loaded completion checkbox for task rows.
//
// Stands in for dw-time-web/src/features/tasks/components/task-list-item/
// task-complete-button.tsx, which is a full-width "Complete" button in the
// card footer — the right control for a mouse, the wrong one for a thumb
// scanning a list. The tap target here is a padded 44pt hit area (Apple HIG
// minimum, `minTouchTarget` in the theme) wrapped around a 26pt box, so the
// primary action on a task is one thumb tap on the left edge of the row where
// the status dot already lives (task-header.tsx:16-21).
//
// The fill springs in and the tick pops a beat later; that overshoot is the
// whole point — it's the confirmation that the tap registered, before the
// network round-trip resolves.

import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing } from "@/theme/tokens";

const BOX_SIZE = 26;
const FILL_SPRING = { damping: 12, stiffness: 220, mass: 0.5, reduceMotion: ReduceMotion.System } as const;
const TICK_SPRING = { damping: 9, stiffness: 320, mass: 0.4, reduceMotion: ReduceMotion.System } as const;
const TICK_DELAY_MS = 60;

export interface CompleteCheckboxProps {
  checked: boolean;
  onPress: () => void;
  /** Screen-reader label — callers pass the task-specific wording. */
  accessibilityLabel: string;
  /** DONE tasks keep the box visible but stop accepting taps. */
  disabled?: boolean;
}

export function CompleteCheckbox({ checked, onPress, accessibilityLabel, disabled }: CompleteCheckboxProps) {
  const fill = useSharedValue(checked ? 1 : 0);
  const tick = useSharedValue(checked ? 1 : 0);
  const press = useSharedValue(0);

  useEffect(() => {
    if (checked) {
      fill.value = withSpring(1, FILL_SPRING);
      tick.value = withDelay(TICK_DELAY_MS, withSpring(1, TICK_SPRING));
    } else {
      tick.value = withTiming(0, { duration: 120, reduceMotion: ReduceMotion.System });
      fill.value = withSpring(0, FILL_SPRING);
    }
  }, [checked, fill, tick]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.12 }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: 0.6 + fill.value * 0.4 }],
  }));

  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: tick.value }],
  }));

  return (
    <Pressable
      style={styles.hitArea}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => {
        press.value = withSpring(1, FILL_SPRING);
      }}
      onPressOut={() => {
        press.value = withSpring(0, FILL_SPRING);
      }}
    >
      <Animated.View style={[styles.box, checked && styles.boxChecked, boxStyle]}>
        <Animated.View style={[styles.fill, fillStyle]} />
        <Animated.View style={tickStyle}>
          <Icon name="check" size={16} color={colors.successForeground} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    width: minTouchTarget,
    height: minTouchTarget,
    marginLeft: -spacing.sm,
    marginVertical: -spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  boxChecked: {
    borderColor: colors.success,
  },
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.success,
  },
});
