// The Schedule screen — a single day rendered on a real time axis.
//
// This screen used to be a flat agenda list of cards, on the reasoning that
// the web's 7-day drag grid doesn't fit a phone (see packages/shared/src/
// scheduling/grid.ts's header and dw-time-mobile/DECISIONS.md #5). That's
// still true of the *drag grid*, but throwing out the time axis with it threw
// out the thing that makes a schedule legible: dw-time-web/src/features/
// schedule/components/schedule-grid/schedule-grid.tsx positions and sizes
// every block from `timeToMinutes(...) * PX_PER_MIN` against an hour-ruled
// canvas, so duration and empty time are visible rather than implied. This
// screen now does the same for one day at a time. The layout math lives in
// src/components/schedule/layout.ts; the drag/resize interactions do not
// come along.
//
// Still intentionally thin: all time math comes from packages/shared/src/
// scheduling, and the only local logic is wiring the query cache, the day
// selection, and the minute ticker that keeps "now" honest.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import {
  DAYS_OF_WEEK_FULL,
  formatDuration,
  type ScheduleBlock,
  type WeekSchedule,
} from "@goalslot/shared";

import { ErrorState, QuickAddSheet } from "@/components";
import {
  BlockDetailSheet,
  DayStrip,
  getDayWindow,
  minuteToY,
  positionBlocks,
  ScheduleEmptyState,
  Timeline,
  TimelineSkeleton,
} from "@/components/schedule";
import { Icon } from "@/components/ui/Icon";
import { apiClient } from "@/lib/api-client";
import { hapticLight } from "@/lib/haptics";
import { scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
// `typeScale` is the primitive half of the same token set `tokens.ts` re-exports
// (both resolve to theme/foundation.ts) — used here only where a semantic role
// needs a larger size than its default, so no number is invented locally.
import { typography as typeScale } from "@/theme";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

// Sunday=0 ... Saturday=6, matching Date.getDay() / WeekSchedule's keys —
// fixed at module load for the *initial* selection only; the live day index
// used for rendering is derived from the ticking clock below so a session left
// open across midnight doesn't keep calling yesterday "today".
const TODAY_INDEX = new Date().getDay();
const DAYS_IN_WEEK = 7;
/** Matches the web's 30s activeBlock ticker (schedule-page.tsx), halved cost. */
const CLOCK_TICK_MS = 60_000;
/** How far above the now line to park the scroll, so context sits above it. */
const NOW_SCROLL_HEADROOM = 140;
const BLOCK_SCROLL_HEADROOM = 24;

export default function ScheduleScreen() {
  const analytics = useAnalytics();
  const [selectedDay, setSelectedDay] = useState(TODAY_INDEX);
  const [now, setNow] = useState(() => new Date());
  const [detailBlock, setDetailBlock] = useState<ScheduleBlock | null>(null);

  const quickAddRef = useRef<BottomSheetModal>(null);
  const detailRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<ScrollView>(null);

  // expo-router re-exports react-navigation's useFocusEffect directly (see
  // node_modules/expo-router/build/useFocusEffect.js) — no extra dependency
  // needed. Fires on every tab return, not just the first mount, matching
  // the other v1 screens' screenViewed timing.
  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "schedule" } });
    }, [analytics]),
  );

  // Keeps the now line, the active-block emphasis and the past/upcoming split
  // truthful while the screen sits open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const weeklyQuery = useQuery(scheduleQueries.weekly());

  // Cached-first: `isPending` (data === undefined) already reflects "nothing
  // to show yet" whether that's a cold first load or an empty persisted
  // cache — unlike `isLoading`, it stays false once persisted/cached data
  // exists even while a background refetch is in flight, so a revisit never
  // flashes a blocking skeleton over data that's already on screen.
  const showSkeleton = weeklyQuery.isPending;

  const todayIndex = now.getDay();
  const nowMinutes = selectedDay === todayIndex ? now.getHours() * 60 + now.getMinutes() : null;

  // Sunday-first dates for the week `now` falls in, so each day pill can show
  // its real calendar date rather than just a weekday abbreviation.
  const weekDates = useMemo(() => {
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    return Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + index);
      return date;
    });
  }, [now]);

  const blockCounts = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, index) => weeklyQuery.data?.[index]?.length ?? 0),
    [weeklyQuery.data],
  );

  const entries = useMemo(
    () => positionBlocks(weeklyQuery.data?.[selectedDay] ?? []),
    [weeklyQuery.data, selectedDay],
  );

  const dayWindow = useMemo(
    () => getDayWindow(weeklyQuery.data?.[selectedDay] ?? []),
    [weeklyQuery.data, selectedDay],
  );

  const scheduledMinutes = useMemo(
    () => entries.reduce((total, entry) => total + (entry.endMin - entry.startMin), 0),
    [entries],
  );

  // Land the viewport where the day's attention belongs — on the now line for
  // today, on the first block otherwise — instead of at whatever hour the
  // window happens to start.
  useEffect(() => {
    if (showSkeleton) return;
    const target =
      nowMinutes !== null
        ? minuteToY(nowMinutes, dayWindow) - NOW_SCROLL_HEADROOM
        : entries.length > 0
          ? minuteToY(entries[0].startMin, dayWindow) - BLOCK_SCROLL_HEADROOM
          : 0;
    scrollRef.current?.scrollTo({ y: Math.max(0, target), animated: true });
    // `nowMinutes` is read but deliberately NOT a dependency: it changes every
    // minute, and re-scrolling the viewport under someone who is reading their
    // day would be hostile. The effect only fires when the day, the data, or
    // the window actually changes, and reads the current minute at that point.
  }, [selectedDay, showSkeleton, entries, dayWindow]);

  const handleDeleteBlock = useCallback(
    async (block: ScheduleBlock) => {
      const weeklyKey = scheduleQueries.scheduleQueries.weeklyKey();
      const previous = queryClient.getQueryData<WeekSchedule>(weeklyKey);

      queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
        const week = existing ?? {};
        const dayList = week[block.dayOfWeek] ?? [];
        return { ...week, [block.dayOfWeek]: dayList.filter((entry) => entry.id !== block.id) };
      });

      try {
        await apiClient.schedule.delete(block.id);
        analytics.track({ name: "scheduleBlockDeleted", payload: { scheduleBlockId: block.id } });
      } catch {
        queryClient.setQueryData(weeklyKey, previous);
        Alert.alert("Couldn't delete", "That time slot is still there — please try again.");
      }
    },
    [analytics],
  );

  const openQuickAdd = useCallback(() => {
    hapticLight();
    quickAddRef.current?.present();
  }, []);

  const handleSelectBlock = useCallback((block: ScheduleBlock) => {
    setDetailBlock(block);
    detailRef.current?.present();
  }, []);

  const dayLabel = DAYS_OF_WEEK_FULL[selectedDay];
  const blockCount = entries.length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        {/* Web PageHeader's eyebrow/title/description trio (schedule-page.tsx). */}
        <Text style={styles.eyebrow}>Plan your week</Text>
        <Text style={styles.headerTitle}>Schedule</Text>
      </View>

      <DayStrip
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        weekDates={weekDates}
        blockCounts={blockCounts}
        onSelectDay={setSelectedDay}
      />

      <View style={styles.summaryRow}>
        <Text style={styles.summaryDay}>{dayLabel}</Text>
        <Text style={styles.summaryMeta}>
          {blockCount === 0
            ? "Nothing scheduled"
            : `${blockCount} ${blockCount === 1 ? "block" : "blocks"} · ${formatDuration(scheduledMinutes)}`}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={weeklyQuery.isFetching && !weeklyQuery.isPending}
            onRefresh={() => {
              void weeklyQuery.refetch();
            }}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {showSkeleton ? (
          <TimelineSkeleton />
        ) : weeklyQuery.isError ? (
          <ErrorState
            message="Couldn't load your schedule."
            onRetry={() => {
              void weeklyQuery.refetch();
            }}
          />
        ) : blockCount === 0 ? (
          <ScheduleEmptyState dayLabel={dayLabel} onAddBlock={openQuickAdd} />
        ) : (
          <Timeline
            // Remounting on day change re-runs each block's entrance stagger,
            // which is what signals "this is a different day" when the header
            // above barely changes.
            key={selectedDay}
            window={dayWindow}
            entries={entries}
            nowMinutes={nowMinutes}
            onSelectBlock={handleSelectBlock}
            onPressEmptyHour={openQuickAdd}
          />
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={openQuickAdd} accessibilityRole="button" accessibilityLabel="Add time slot">
        <Icon name="add" size={26} color={colors.primaryForeground} />
      </Pressable>

      <QuickAddSheet ref={quickAddRef} kind="slot" />
      <BlockDetailSheet
        ref={detailRef}
        block={detailBlock}
        onDelete={handleDeleteBlock}
        onDismiss={() => setDetailBlock(null)}
      />
    </SafeAreaView>
  );
}

const FAB_SIZE = 56;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xxs,
  },
  eyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  headerTitle: {
    ...typography.h1,
    fontSize: typeScale.size.xxl,
    color: colors.foreground,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  summaryDay: {
    ...typography.h2,
    color: colors.foreground,
  },
  summaryMeta: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl * 3,
  },
  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.fab,
  },
});
