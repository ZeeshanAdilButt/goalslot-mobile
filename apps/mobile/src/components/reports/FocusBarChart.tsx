// Minutes logged per day, drawn with react-native-svg.
//
// Replaces a stack of <View>s pretending to be a chart. Real SVG buys three
// things that mattered here: a proper y-axis gutter with value ticks, bars
// that can animate their height on the UI thread, and sane rendering when a
// month view packs 31 bars into ~270pt of width.
//
// Structure mirrors dw-time-web's FocusTrendCard
// (dw-time-web/src/features/reports/components/focus-trend-card.tsx): a
// CartesianGrid-equivalent set of dashed gridlines, a labelled y-axis, and a
// categorical x-axis — the difference being bars rather than a line, which
// reads better than a 31-point polyline at phone width.
//
// Colour: bars are foreground-dark rather than brand yellow on purpose. A
// 4pt-wide #F2CC0D bar on a white card is close to invisible; yellow is used
// as an accent for the single "today" bar, where being different is the
// whole point, not as the series colour.

import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { formatDuration } from "@goalslot/shared";

import type { DayBucket } from "@/components/reports/aggregate";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, spacing } from "@/theme/tokens";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const PLOT_HEIGHT = 132;
const LABEL_ROW_HEIGHT = 18;
const Y_AXIS_WIDTH = 32;
/** Keeps a zero-minute day visible as a baseline tick rather than nothing at all. */
const MIN_BAR_HEIGHT = 2;
const GROW_DURATION = 420;
/** Whole-chart stagger budget — the brief's 150-300ms, spread across however many bars there are. */
const TOTAL_STAGGER = 260;
/**
 * Horizontal room a 10pt x-axis label needs before it touches its neighbour:
 * two digits at ~6pt plus a gap. Used to decide when two labels are too close
 * to both be drawn.
 */
const LABEL_MIN_WIDTH = 18;

/**
 * Compact axis tick — "45m", "2h", "2.5h". Same intent as dw-time-web's
 * `formatMinutesAsHoursTick` (features/reports/utils/aggregation.ts): axis
 * ticks need to be short, unlike the "1h 20m" form `formatDuration` produces
 * for prose.
 */
function formatTick(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

interface BarProps {
  x: number;
  width: number;
  baselineY: number;
  targetHeight: number;
  color: string;
  delay: number;
  radius: number;
  reduceMotion: boolean;
}

function Bar({ x, width, baselineY, targetHeight, color, delay, radius, reduceMotion }: BarProps) {
  const grow = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      grow.value = 1;
      return;
    }
    grow.value = 0;
    grow.value = withDelay(delay, withTiming(1, { duration: GROW_DURATION, easing: Easing.out(Easing.cubic) }));
  }, [delay, grow, reduceMotion, targetHeight]);

  const animatedProps = useAnimatedProps(() => {
    const height = Math.max(MIN_BAR_HEIGHT, targetHeight * grow.value);
    return { y: baselineY - height, height };
  });

  const restingHeight = Math.max(MIN_BAR_HEIGHT, targetHeight);

  return (
    <AnimatedRect
      x={x}
      // Static props describe the FINISHED bar, not the starting one: if the
      // animated props never take effect the chart still reads correctly,
      // just without the grow-in.
      y={baselineY - restingHeight}
      width={width}
      height={restingHeight}
      rx={radius}
      fill={color}
      animatedProps={animatedProps}
    />
  );
}

export interface FocusBarChartProps {
  buckets: DayBucket[];
  /** Chart width in points, measured by the caller. Nothing renders until it's known. */
  width: number;
  /** Label every Nth bar. 1 for a week (7 bars), ~7 for a month (28-31 bars). */
  labelEvery?: number;
  /** `dateKey` of the day currently drilled into, if any — drawn with a highlight. */
  selectedDateKey?: string | null;
  /** Fires with a bucket's `dateKey` when its column is tapped. Omit to render a static, unpressable chart. */
  onSelectDay?: (dateKey: string) => void;
}

export function FocusBarChart({ buckets, width, labelEvery = 1, selectedDateKey, onSelectDay }: FocusBarChartProps) {
  // One listener for the whole chart rather than one per bar — a month view
  // would otherwise register 31 AccessibilityInfo subscriptions.
  const reduceMotion = useReduceMotion();

  if (width <= 0 || buckets.length === 0) {
    return <View style={styles.placeholder} />;
  }

  const plotWidth = width - Y_AXIS_WIDTH;
  const baselineY = PLOT_HEIGHT;
  const maxMinutes = Math.max(...buckets.map((bucket) => bucket.minutes));
  // An all-zero period still needs a sensible axis, otherwise every tick reads "0m".
  const scaleMax = maxMinutes > 0 ? maxMinutes : 60;

  const slot = plotWidth / buckets.length;
  const gap = buckets.length > 12 ? 2 : 8;
  const barWidth = Math.max(2, slot - gap);
  const radius = Math.min(barWidth / 2, 4);
  const perBarDelay = TOTAL_STAGGER / Math.max(1, buckets.length - 1);

  const todayIndex = buckets.findIndex((bucket) => bucket.isToday);
  // Minimum slots between two drawn labels. Derived from the actual slot
  // width rather than fixed, so a week view (~40pt slots, where adjacent
  // labels are perfectly legible) never suppresses anything.
  const minLabelGap = Math.max(1, Math.ceil(LABEL_MIN_WIDTH / Math.max(slot, 1)));

  const gridFractions = [0, 0.5, 1];
  const chartHeight = PLOT_HEIGHT + LABEL_ROW_HEIGHT;
  const selectedIndex = buckets.findIndex((bucket) => bucket.dateKey === selectedDateKey);

  return (
    <Svg width={width} height={chartHeight}>
      {selectedIndex >= 0 ? (
        // Painted first so grid, bars and labels all sit on top of it — a
        // full-height tint is what makes the selection legible even on a
        // near-zero bar, where the bar's own colour change is too small to
        // notice.
        <Rect
          x={Y_AXIS_WIDTH + selectedIndex * slot}
          y={0}
          width={slot}
          height={chartHeight}
          rx={4}
          fill={colors.primaryMuted}
        />
      ) : null}

      {gridFractions.map((fraction) => {
        const y = baselineY - PLOT_HEIGHT * fraction;
        return (
          <Line
            key={fraction}
            x1={Y_AXIS_WIDTH}
            y1={y}
            x2={width}
            y2={y}
            stroke={colors.border}
            strokeWidth={1}
            // The baseline is solid; the two above it are dashed so they sit
            // behind the data instead of competing with it.
            strokeDasharray={fraction === 0 ? undefined : "3 4"}
          />
        );
      })}

      {gridFractions.map((fraction) => (
        <SvgText
          key={`tick-${fraction}`}
          x={Y_AXIS_WIDTH - spacing.sm}
          y={baselineY - PLOT_HEIGHT * fraction + 3}
          fontSize={9}
          fill={colors.mutedForeground}
          textAnchor="end"
        >
          {formatTick(scaleMax * fraction)}
        </SvgText>
      ))}

      {buckets.map((bucket, index) => {
        const x = Y_AXIS_WIDTH + index * slot + gap / 2;
        const targetHeight = maxMinutes > 0 ? (bucket.minutes / scaleMax) * PLOT_HEIGHT : 0;
        const isSelected = bucket.dateKey === selectedDateKey;
        const color = bucket.minutes === 0 ? colors.border : bucket.isToday ? colors.primaryDark : colors.foreground;

        return (
          <Bar
            key={bucket.dateKey}
            x={x}
            width={barWidth}
            baselineY={baselineY}
            targetHeight={targetHeight}
            // Selected wins over every other state — including "today" — so
            // tapping today's own bar still visibly confirms the tap.
            color={bucket.isFuture ? colors.secondary : isSelected ? colors.primary : color}
            delay={index * perBarDelay}
            radius={radius}
            reduceMotion={reduceMotion}
          />
        );
      })}

      {buckets.map((bucket, index) => {
        // Label sparingly: 31 day-numbers under a month view is unreadable,
        // so only every Nth gets one — plus today, always.
        //
        // The "plus today" clause is what forces the second condition. On a
        // month view (labelEvery 7, slots ~8pt wide) today landing on or
        // beside a scheduled label drew both, and two 10pt day-numbers 8pt
        // apart overlap into an unreadable smear. Today wins the collision;
        // the scheduled label next to it is dropped.
        const isSelected = bucket.dateKey === selectedDateKey;
        const isCollidingWithToday =
          todayIndex >= 0 && !bucket.isToday && Math.abs(index - todayIndex) < minLabelGap;
        // A selected label is always drawn, same as today's — the whole
        // point of tapping a day is to single it out, so its label can't be
        // the one a busy month view decides to skip.
        const shouldLabel = bucket.isToday || isSelected || (index % labelEvery === 0 && !isCollidingWithToday);
        if (!shouldLabel) return null;
        return (
          <SvgText
            key={`label-${bucket.dateKey}`}
            x={Y_AXIS_WIDTH + index * slot + slot / 2}
            y={baselineY + LABEL_ROW_HEIGHT - 4}
            fontSize={10}
            fontWeight={bucket.isToday || isSelected ? "700" : "400"}
            fill={bucket.isToday || isSelected ? colors.foreground : colors.mutedForeground}
            textAnchor="middle"
          >
            {bucket.label}
          </SvgText>
        );
      })}

      {onSelectDay
        ? // Invisible hit targets, one per column, drawn last so they sit
          // above the bars and grab the tap instead of a bar underneath
          // eating it. A transparent fill still registers touches in
          // react-native-svg — hit-testing is by shape geometry, not pixel
          // alpha — and a full-height target is far easier to hit than the
          // bar itself, which can be a couple of points tall.
          buckets.map((bucket, index) => (
            <Rect
              key={`hit-${bucket.dateKey}`}
              x={Y_AXIS_WIDTH + index * slot}
              y={0}
              width={slot}
              height={chartHeight}
              fill="transparent"
              onPress={() => onSelectDay(bucket.dateKey)}
              accessible
              accessibilityLabel={`${bucket.label}, ${formatDuration(bucket.minutes)}${bucket.dateKey === selectedDateKey ? ", selected" : ""}`}
            />
          ))
        : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: PLOT_HEIGHT + LABEL_ROW_HEIGHT,
  },
});
