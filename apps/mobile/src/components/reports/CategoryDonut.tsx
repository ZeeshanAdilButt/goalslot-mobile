// Time-by-category donut plus its legend.
//
// The mobile counterpart of dw-time-web's FocusCategoryPieCard
// (dw-time-web/src/features/reports/components/focus-category-pie-card.tsx),
// with two deliberate departures:
//
//   1. A donut, not a pie. The hole earns its keep by holding the period
//      total, which the web card has nowhere to put.
//   2. Colours come from the user's own Category records rather than the
//      web card's hardcoded `COLORS` array of eight generic chart hues (see
//      buildCategoryBreakdown in ./aggregate.ts). Slice colour therefore
//      matches the swatch the user picked on the Categories screen, so the
//      same category is the same colour everywhere in the app.
//
// Long tails are folded into a single "Other" slice: past about five
// segments a donut at phone width stops being readable and the legend
// starts scrolling, and neither helps anyone understand where their time
// went.

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, G } from "react-native-svg";

import { formatDuration } from "@goalslot/shared";

import type { CategorySlice } from "@/components/reports/aggregate";
import { Reveal } from "@/components/reports/Reveal";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, radii, spacing, typography } from "@/theme/tokens";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const STROKE = 22;
const SWEEP_DURATION = 700;
const MAX_SLICES = 5;
/** Arc length dropped between segments so neighbouring colours don't bleed together. */
const SEGMENT_GAP = 3;

interface SegmentProps {
  sweep: SharedValue<number>;
  center: number;
  radius: number;
  circumference: number;
  /** Arc length before this segment starts. */
  start: number;
  /** Arc length of this segment. */
  length: number;
  color: string;
}

function DonutSegment({ sweep, center, radius, circumference, start, length, color }: SegmentProps) {
  // A single shared `sweep` drives every segment, so the ring draws itself
  // once around like a clock hand rather than all segments fading in at once.
  const animatedProps = useAnimatedProps(() => {
    const visible = Math.min(Math.max(circumference * sweep.value - start, 0), length);
    return { strokeDasharray: [visible, circumference] };
  });

  return (
    <AnimatedCircle
      cx={center}
      cy={center}
      r={radius}
      stroke={color}
      strokeWidth={STROKE}
      fill="none"
      // Negative offset shifts the dash pattern forward, parking this
      // segment's dash at its own start position on the circle.
      strokeDashoffset={-start}
      // Static value is the FINISHED segment, so a donut whose animated
      // props never land still renders complete rather than blank.
      strokeDasharray={[length, circumference]}
      animatedProps={animatedProps}
    />
  );
}

export interface CategoryDonutProps {
  slices: CategorySlice[];
  /** Diameter in points. */
  size: number;
}

export function CategoryDonut({ slices, size }: CategoryDonutProps) {
  const reduceMotion = useReduceMotion();
  const sweep = useSharedValue(0);

  const visibleSlices = foldLongTail(slices);
  const total = visibleSlices.reduce((sum, slice) => sum + slice.minutes, 0);

  useEffect(() => {
    if (reduceMotion) {
      sweep.value = 1;
      return;
    }
    sweep.value = 0;
    sweep.value = withTiming(1, { duration: SWEEP_DURATION, easing: Easing.out(Easing.cubic) });
  }, [reduceMotion, sweep, total]);

  const center = size / 2;
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  let cursor = 0;
  const segments = visibleSlices.map((slice) => {
    const arc = total > 0 ? (slice.minutes / total) * circumference : 0;
    const segment = {
      key: slice.key,
      color: slice.color,
      start: cursor,
      // Never let the gap eat a thin slice entirely.
      length: Math.max(arc - SEGMENT_GAP, Math.min(arc, 1)),
    };
    cursor += arc;
    return segment;
  });

  return (
    <View style={styles.container}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={center} cy={center} r={radius} stroke={colors.secondary} strokeWidth={STROKE} fill="none" />
          {/* rotate -90 so the first (largest) slice starts at 12 o'clock. */}
          <G rotation={-90} originX={center} originY={center}>
            {segments.map((segment) => (
              <DonutSegment
                key={segment.key}
                sweep={sweep}
                center={center}
                radius={radius}
                circumference={circumference}
                start={segment.start}
                length={segment.length}
                color={segment.color}
              />
            ))}
          </G>
        </Svg>

        <View style={styles.centerContent} pointerEvents="none">
          <Text style={styles.centerValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {formatDuration(total)}
          </Text>
          <Text style={styles.centerCaption}>tracked</Text>
        </View>
      </View>

      <View style={styles.legend}>
        {visibleSlices.map((slice, index) => (
          <Reveal key={slice.key} delay={120 + index * 60}>
            <View
              style={styles.legendRow}
              accessible
              accessibilityLabel={`${slice.name}: ${formatDuration(slice.minutes)}, ${percentOf(slice.minutes, total)} percent`}
            >
              <View style={[styles.legendSwatch, { backgroundColor: slice.color }]} />
              <Text style={styles.legendName} numberOfLines={1}>
                {slice.name}
              </Text>
              <Text style={styles.legendPercent}>{percentOf(slice.minutes, total)}%</Text>
              <Text style={styles.legendValue}>{formatDuration(slice.minutes)}</Text>
            </View>
          </Reveal>
        ))}
      </View>
    </View>
  );
}

function percentOf(minutes: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((minutes / total) * 100);
}

/** Keeps the top MAX_SLICES and rolls everything below into one neutral "Other". */
function foldLongTail(slices: CategorySlice[]): CategorySlice[] {
  if (slices.length <= MAX_SLICES) return slices;
  const head = slices.slice(0, MAX_SLICES - 1);
  const tailMinutes = slices.slice(MAX_SLICES - 1).reduce((sum, slice) => sum + slice.minutes, 0);
  return [
    ...head,
    { key: "__other__", name: `Other (${slices.length - head.length})`, minutes: tailMinutes, color: colors.mutedForeground },
  ];
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.xl,
  },
  centerContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: STROKE + spacing.sm,
  },
  centerValue: {
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.6,
    color: colors.foreground,
  },
  centerCaption: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  legend: {
    width: "100%",
    gap: spacing.sm,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: radii.sm,
  },
  legendName: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },
  legendPercent: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.mutedForeground,
    minWidth: 36,
    textAlign: "right",
  },
  legendValue: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.foreground,
    minWidth: 56,
    textAlign: "right",
  },
});
