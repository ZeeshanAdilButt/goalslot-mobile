// Week / month segmented control for the Reports screen.
//
// The selected state is a sliding pill rather than a colour swap on the
// label, because a two-option control needs the selection to be readable at
// a glance from across the card. The pill is driven by Reanimated on the UI
// thread so it tracks the tap immediately even while the charts behind it
// are re-animating with new data.
//
// Each segment is a 44pt-tall half of the control — comfortably past the
// HIG/Material minimum target, and the whole row is thumb-width so neither
// option is a precision tap.

import { useCallback, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { ReportPeriod } from "@/components/reports/aggregate";
import { hapticSlotTick } from "@/lib/haptics";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

const TRACK_PADDING = 3;

export interface PeriodSelectorProps {
  value: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const offset = useSharedValue(0);

  const segmentWidth = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / OPTIONS.length : 0;

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      setTrackWidth(width);
      // Position the pill without animating on the very first measurement,
      // otherwise it visibly slides in from the left on mount.
      const index = OPTIONS.findIndex((option) => option.value === value);
      offset.value = ((width - TRACK_PADDING * 2) / OPTIONS.length) * Math.max(0, index);
    },
    [offset, value],
  );

  const handlePress = useCallback(
    (option: ReportPeriod, index: number) => {
      if (option !== value) hapticSlotTick();
      offset.value = withTiming(segmentWidth * index, { duration: 200, easing: Easing.out(Easing.cubic) });
      onChange(option);
    },
    [offset, onChange, segmentWidth, value],
  );

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View style={styles.track} onLayout={onLayout} accessibilityRole="tablist">
      {segmentWidth > 0 ? (
        <Animated.View style={[styles.indicator, { width: segmentWidth }, indicatorStyle]} />
      ) : null}
      {OPTIONS.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={styles.segment}
            onPress={() => handlePress(option.value, index)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    padding: TRACK_PADDING,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  indicator: {
    position: "absolute",
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: radii.full,
    backgroundColor: colors.card,
  },
  segment: {
    flex: 1,
    minHeight: minTouchTarget - TRACK_PADDING * 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  segmentLabel: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  segmentLabelSelected: {
    color: colors.foreground,
    fontWeight: "700",
  },
});
