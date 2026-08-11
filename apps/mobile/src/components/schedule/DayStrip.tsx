// The week selector.
//
// WHY a date number under each weekday rather than the bare "Sun Mon Tue"
// pills this screen had: the web's schedule is a full 7-day grid where every
// day is on screen at once (schedule-grid.tsx's `grid-cols-[4rem_repeat(7,...)]`),
// so its column headers only ever need the weekday. Mobile shows one day at a
// time, so the selector is the ONLY thing telling you which day you're looking
// at — it has to carry the date, today's identity, and how full each day is,
// or the screen loses its sense of place.
//
// WHY horizontally scrollable when seven pills nominally fit: at a 44pt+ touch
// target with a date number and a load indicator, seven pills overflow a 360dp
// screen at larger system font scales. Scrolling degrades gracefully; cramming
// does not.

import { memo, useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { DAYS_OF_WEEK, DAYS_OF_WEEK_FULL } from "@goalslot/shared";

import { hapticLight } from "@/lib/haptics";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const PILL_WIDTH = 52;
const PILL_HEIGHT = 74;
const DOT_SIZE = spacing.xs;
const PRESS_SPRING = { damping: 18, stiffness: 260 } as const;

export interface DayStripProps {
  selectedDay: number;
  /** `Date.getDay()` of the current device day — 0 = Sunday. */
  todayIndex: number;
  /** Sunday-first dates of the week currently shown, aligned to WeekSchedule keys. */
  weekDates: readonly Date[];
  /** Number of scheduled blocks per day, aligned to WeekSchedule keys. */
  blockCounts: readonly number[];
  onSelectDay: (day: number) => void;
}

// Memoised because the screen above re-renders once a minute off its clock
// ticker, and nothing in this strip changes on a minute boundary — only on a
// day selection, a data change, or midnight.
export const DayStrip = memo(function DayStrip({
  selectedDay,
  todayIndex,
  weekDates,
  blockCounts,
  onSelectDay,
}: DayStripProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // MUST stay: RN composes every ScrollView's own `baseHorizontal` style
      // (flexGrow: 1, flexShrink: 1 — see ScrollView.js) under whatever `style`
      // is passed. In a `flex: 1` column that grow makes this strip fight the
      // timeline's ScrollView for the leftover height and take half of it,
      // opening hundreds of dp of dead space under the pills. Pinning it to
      // its content height is the only thing that makes a horizontal strip
      // behave like a row instead of a panel.
      style={styles.scroll}
      contentContainerStyle={styles.strip}
      // Snapping makes the strip feel like a control rather than a scroll area.
      decelerationRate="fast"
    >
      {DAYS_OF_WEEK.map((label, index) => (
        <DayPill
          key={label}
          index={index}
          label={label}
          date={weekDates[index]}
          count={blockCounts[index] ?? 0}
          isSelected={index === selectedDay}
          isToday={index === todayIndex}
          onSelectDay={onSelectDay}
        />
      ))}
    </ScrollView>
  );
});

interface DayPillProps {
  index: number;
  label: string;
  date: Date | undefined;
  count: number;
  isSelected: boolean;
  isToday: boolean;
  onSelectDay: (day: number) => void;
}

const DayPill = memo(function DayPill({
  index,
  label,
  date,
  count,
  isSelected,
  isToday,
  onSelectDay,
}: DayPillProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = useCallback(() => {
    // Selection is the one gesture on this screen with no other confirmation
    // (the timeline just swaps underneath), so it gets the tap haptic.
    hapticLight();
    onSelectDay(index);
  }, [index, onSelectDay]);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.94, PRESS_SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, PRESS_SPRING);
      }}
      accessibilityRole="button"
      // The pill shows three things visually — weekday, date, and whether it's
      // today (the brand ring). A label of just "Tuesday" dropped the other
      // two, leaving a screen reader user unable to tell which Tuesday they
      // were on or where today sat in the week.
      accessibilityLabel={[
        DAYS_OF_WEEK_FULL[index],
        date ? String(date.getDate()) : null,
        isToday ? "today" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      accessibilityHint={count === 1 ? "1 block scheduled" : `${count} blocks scheduled`}
      accessibilityState={{ selected: isSelected }}
    >
      <Animated.View
        style={[
          styles.pill,
          isToday && !isSelected && styles.pillToday,
          isSelected && styles.pillSelected,
          animatedStyle,
        ]}
      >
        <Text style={[styles.weekday, isSelected && styles.weekdaySelected]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.date, isSelected && styles.dateSelected]} numberOfLines={1}>
          {date ? date.getDate() : ""}
        </Text>
        <LoadDots count={count} isSelected={isSelected} />
      </Animated.View>
    </Pressable>
  );
});

const MAX_DOTS = 3;

/**
 * Up to three dots standing in for "how full is this day". A raw count number
 * competes with the date number for the same glance; dots read as density
 * without adding a second digit to parse.
 */
function LoadDots({ count, isSelected }: { count: number; isSelected: boolean }) {
  if (count === 0) {
    return <View style={styles.dotRow} />;
  }
  const dots = Math.min(count, MAX_DOTS);
  return (
    <View style={styles.dotRow}>
      {Array.from({ length: dots }).map((_, dotIndex) => (
        <View key={dotIndex} style={[styles.dot, isSelected && styles.dotSelected]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    // Neutralises RN's baseHorizontal flex defaults (see the ScrollView above).
    // flexShrink is 0 too: on a short screen the day selector is the last thing
    // that should be squeezed — the timeline below it already absorbs.
    flexGrow: 0,
    flexShrink: 0,
  },
  strip: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  pill: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Today, when it isn't the selected day, is marked with a brand ring rather
  // than a fill — restraint: only one pill on screen is allowed to be solid
  // yellow, and that's the selection.
  pillToday: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  pillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadows.card,
  },
  weekday: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  weekdaySelected: {
    color: colors.primaryForeground,
  },
  date: {
    ...typography.h1,
    color: colors.foreground,
  },
  dateSelected: {
    color: colors.primaryForeground,
  },
  dotRow: {
    flexDirection: "row",
    gap: spacing.xxs,
    height: DOT_SIZE,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.mutedForeground,
  },
  dotSelected: {
    backgroundColor: colors.primaryForeground,
  },
});
