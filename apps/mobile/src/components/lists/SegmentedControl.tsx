// Two-or-three-way filter switch, used for the Goals status tabs.
//
// Replaces the pair of full-width buttons the Goals screen used to draw
// inline. The web filters goals with a `<Select>` dropdown
// (dw-time-web/src/features/goals/components/goals-filters.tsx:41-52) — a
// dropdown is the right control when there are three statuses and a lot of
// other filters beside it, but hiding a two-way toggle behind a tap is
// pointless on a phone, so the same filter is surfaced as the native
// segmented idiom: one inset track, the selected segment lifted onto a card
// surface.
//
// Selection is animated with a spring on the *segment*, not a sliding
// thumb — a sliding thumb needs measured layout and re-measures on rotation;
// this reads the same and can't desync.

import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useDerivedValue, withSpring } from "react-native-reanimated";

import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const SPRING = { damping: 18, stiffness: 240, mass: 0.6, reduceMotion: ReduceMotion.System } as const;

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional trailing count, e.g. how many goals are in this status. */
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <View style={styles.track}>
      {options.map((option) => (
        <Segment
          key={option.value}
          option={option}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function Segment<T extends string>({
  option,
  selected,
  onPress,
}: {
  option: SegmentOption<T>;
  selected: boolean;
  onPress: () => void;
}) {
  const progress = useDerivedValue(() => withSpring(selected ? 1 : 0, SPRING), [selected]);

  const surfaceStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.94 + progress.value * 0.06 }],
  }));

  return (
    <Pressable
      style={styles.segment}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={option.label}
      accessibilityState={{ selected }}
    >
      <Animated.View style={[styles.segmentSurface, surfaceStyle]} pointerEvents="none" />
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]} numberOfLines={1}>
        {option.label}
      </Text>
      {typeof option.count === "number" ? (
        <View style={[styles.count, selected && styles.countSelected]}>
          <Text style={[styles.countText, selected && styles.countTextSelected]}>{option.count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    padding: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget - spacing.sm,
    borderRadius: radii.full,
  },
  segmentSurface: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.full,
    backgroundColor: colors.card,
    ...shadows.card,
  },
  segmentLabel: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  segmentLabelSelected: {
    color: colors.foreground,
  },
  count: {
    minWidth: 20,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radii.full,
    backgroundColor: colors.card,
    alignItems: "center",
  },
  countSelected: {
    backgroundColor: colors.primary,
  },
  countText: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  countTextSelected: {
    // Dark ink on brand yellow — never white.
    color: colors.primaryForeground,
  },
});
