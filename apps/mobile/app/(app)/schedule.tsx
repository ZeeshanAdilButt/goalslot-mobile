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

import { ErrorState } from "@/components";
import {
  BlockDetailSheet,
  DayStrip,
  getDayWindow,
  minuteToY,
  positionBlocks,
  ScheduleBlockSheet,
  Timeline,
  TimelineSkeleton,
  type ScheduleBlockSheetRef,
} from "@/components/schedule";
import { Icon } from "@/components/ui/Icon";
import { apiClient } from "@/lib/api-client";
import { hapticLight } from "@/lib/haptics";
import { scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useScheduleReminders } from "@/lib/useScheduleReminders";
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
/** Same value index.tsx uses to keep header content clear of the floating hamburger (_layout.tsx). */
const HAMBURGER_CLEARANCE = 64;

export default function ScheduleScreen() {
  const analytics = useAnalytics();
  const [selectedDay, setSelectedDay] = useState(TODAY_INDEX);
  const [now, setNow] = useState(() => new Date());
  const [detailBlock, setDetailBlock] = useState<ScheduleBlock | null>(null);

  const blockSheetRef = useRef<ScheduleBlockSheetRef>(null);
  const detailRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Offset the incoming day should land on, consumed once by the ScrollView's
  // onContentSizeChange. `scrollTo` is clamped against whatever contentSize the
  // native view still holds at the moment it's called, and a day change swaps
  // the canvas for one of a different height inside the same commit — so the
  // effect below can only *ask* for a position; this is what lands it.
  const pendingScrollY = useRef<number | null>(null);
  // Day the viewport has already been positioned for. Null until data arrives.
  const landedDay = useRef<number | null>(null);

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

  // Midnight of the day `now` falls in, as a plain timestamp. The clock above
  // ticks every minute but the week only turns over at midnight, so keying the
  // week off a primitive day boundary keeps `weekDates` referentially stable
  // between ticks — otherwise all seven pills get fresh Date props, and their
  // React.memo does nothing, sixty times an hour.
  const todayStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    [now],
  );

  // Sunday-first dates for the week `now` falls in, so each day pill can show
  // its real calendar date rather than just a weekday abbreviation.
  const weekDates = useMemo(() => {
    const sunday = new Date(todayStart);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    return Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + index);
      return date;
    });
  }, [todayStart]);

  const blockCounts = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, index) => weeklyQuery.data?.[index]?.length ?? 0),
    [weeklyQuery.data],
  );

  const entries = useMemo(
    () => positionBlocks(weeklyQuery.data?.[selectedDay] ?? []),
    [weeklyQuery.data, selectedDay],
  );

  // Every block across the whole week, not just the selected day — reminders
  // cover "all schedule blocks" per the user's own words, not just whichever
  // day happens to be open right now.
  const allBlocks = useMemo(() => Object.values(weeklyQuery.data ?? {}).flat(), [weeklyQuery.data]);
  const reminders = useScheduleReminders(allBlocks);

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
    // Landing the viewport is a once-per-day-selection courtesy, not a standing
    // behaviour. `entries` gets a fresh identity on every background refetch
    // (react-query hands back a new object, positionBlocks maps a new array),
    // and re-running this then would yank the day out from under someone
    // mid-read every time a refetch resolved.
    if (landedDay.current === selectedDay) return;
    landedDay.current = selectedDay;

    const target =
      nowMinutes !== null
        ? minuteToY(nowMinutes, dayWindow) - NOW_SCROLL_HEADROOM
        : entries.length > 0
          ? minuteToY(entries[0].startMin, dayWindow) - BLOCK_SCROLL_HEADROOM
          : 0;
    const y = Math.max(0, target);
    pendingScrollY.current = y;
    scrollRef.current?.scrollTo({ y, animated: true });
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

  // Every "+" affordance on this screen (FAB, an empty hour row, the
  // empty-state CTA) opens the full create sheet directly rather than
  // QuickAddSheet's title-only flow — QuickAddSheet has no start/end time or
  // multi-day selection (see its own header comment on why it stays that
  // way), which is exactly the gap this screen exists to close ("cant even
  // add a slot at proper time... cant select that a slot can be for multiple
  // days"). QuickAddSheet itself is untouched and still used by Today/Goals/
  // Tasks for their own kind="goal"/"task"/"slot" quick-adds.
  const presentCreateSheet = useCallback(
    (startTime?: string) => {
      hapticLight();
      blockSheetRef.current?.present({ mode: "create", dayOfWeek: selectedDay, startTime });
    },
    [selectedDay],
  );

  // The FAB has no time in mind, so the sheet keeps the web's 09:00 default.
  // Wrapped rather than passed straight to `onPress`, which would hand the
  // gesture event in as the start time.
  const openCreateSheet = useCallback(() => {
    presentCreateSheet();
  }, [presentCreateSheet]);

  // An hour row does have a time in mind — its own label already says "Add a
  // block at 3 PM", so the sheet has to actually open there.
  const handlePressEmptyHour = useCallback(
    (hour: number) => {
      presentCreateSheet(`${String(hour).padStart(2, "0")}:00`);
    },
    [presentCreateSheet],
  );

  const handleSelectBlock = useCallback((block: ScheduleBlock) => {
    setDetailBlock(block);
    detailRef.current?.present();
  }, []);

  const handleEditBlock = useCallback((block: ScheduleBlock) => {
    blockSheetRef.current?.present({ mode: "edit", block });
  }, []);

  const dayLabel = DAYS_OF_WEEK_FULL[selectedDay];
  const blockCount = entries.length;
  const summaryMeta =
    blockCount === 0
      ? "Nothing scheduled"
      : `${blockCount} ${blockCount === 1 ? "block" : "blocks"} · ${formatDuration(scheduledMinutes)}`;
  // Spoken separately from the visible string: the "·" the eye reads as a
  // separator is announced as a word (or skipped) by a screen reader.
  const summaryLabel =
    blockCount === 0
      ? `${dayLabel}, nothing scheduled`
      : `${dayLabel}, ${blockCount} ${blockCount === 1 ? "block" : "blocks"}, ${formatDuration(scheduledMinutes)} scheduled`;

  const handleToggleAllReminders = useCallback(() => {
    hapticLight();
    void (reminders.allEnabled ? reminders.disableAllReminders() : reminders.enableAllReminders());
  }, [reminders]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          {/* Web PageHeader's eyebrow/title/description trio (schedule-page.tsx). */}
          <View style={styles.headerTitles}>
            <Text style={styles.eyebrow}>Plan your week</Text>
            <Text style={styles.headerTitle}>Schedule</Text>
          </View>

          {/* Bulk on/off for every block's reminder, right from this screen —
              "ability to be able to turn on alarms for all schedule blocks
              and also ability to stop all or one, right from schedule
              screen". Per-block control lives in BlockDetailSheet. */}
          <Pressable
            style={styles.remindersToggle}
            onPress={handleToggleAllReminders}
            disabled={allBlocks.length === 0}
            // The circle reads better at 36 than at 44 next to the title, so
            // the touch target is bought back with hitSlop (36 + 2×8 = 52),
            // the same trade the floating hamburger makes in _layout.tsx.
            hitSlop={spacing.sm}
            accessibilityRole="button"
            accessibilityLabel={reminders.allEnabled ? "Turn off all reminders" : "Turn on all reminders"}
            accessibilityState={{ disabled: allBlocks.length === 0 }}
          >
            <Icon
              name={reminders.allEnabled ? "bell" : "bell-off"}
              size={20}
              color={allBlocks.length === 0 ? colors.mutedForeground : colors.foreground}
            />
          </Pressable>
        </View>
      </View>

      <DayStrip
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        weekDates={weekDates}
        blockCounts={blockCounts}
        onSelectDay={setSelectedDay}
      />

      {/* One accessible node, not two: the day and its load are a single fact,
          and reading them as separate stops makes the reader walk the header
          twice before it reaches the timeline. */}
      <View style={styles.summaryRow} accessible accessibilityRole="header" accessibilityLabel={summaryLabel}>
        <Text style={styles.summaryDay}>{dayLabel}</Text>
        <Text style={styles.summaryMeta}>{summaryMeta}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        // Lands the offset the day-change effect asked for, once the new
        // canvas has actually been measured. See `pendingScrollY`.
        onContentSizeChange={() => {
          const y = pendingScrollY.current;
          if (y === null) return;
          pendingScrollY.current = null;
          scrollRef.current?.scrollTo({ y, animated: false });
        }}
        // Once a finger is on the timeline the day has been read on the user's
        // terms, and no pending landing gets to override that.
        onScrollBeginDrag={() => {
          pendingScrollY.current = null;
        }}
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
        ) : (
          // Always the real grid, even on a day with zero blocks — an
          // illustrated "wide open" card used to replace it entirely, which
          // read as a small floating card in a lot of blank space rather than
          // an actual calendar. getDayWindow([]) already falls back to a
          // sensible waking-hours window (layout.ts), and every hour row is
          // still its own tap-to-add target via onPressEmptyHour below, so an
          // empty day loses nothing — it just looks like a real, empty day.
          <Timeline
            // Remounting on day change re-runs each block's entrance stagger,
            // which is what signals "this is a different day" when the header
            // above barely changes.
            key={selectedDay}
            window={dayWindow}
            entries={entries}
            nowMinutes={nowMinutes}
            onSelectBlock={handleSelectBlock}
            onPressEmptyHour={handlePressEmptyHour}
          />
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={openCreateSheet} accessibilityRole="button" accessibilityLabel="Add time slot">
        <Icon name="add" size={26} color={colors.primaryForeground} />
      </Pressable>

      <ScheduleBlockSheet ref={blockSheetRef} />
      <BlockDetailSheet
        ref={detailRef}
        block={detailBlock}
        onDelete={handleDeleteBlock}
        onEdit={handleEditBlock}
        onDismiss={() => setDetailBlock(null)}
        reminderEnabled={detailBlock ? reminders.isReminderEnabled(detailBlock.id) : true}
        onToggleReminder={() => detailBlock && void reminders.toggleBlockReminder(detailBlock)}
      />
    </SafeAreaView>
  );
}

const FAB_SIZE = 56;
/**
 * Bottom padding on the timeline's scroll content. Derived from the FAB's own
 * footprint (its bottom offset + its height + a gap) rather than picked, so
 * the last hour of the day can never end up parked under the button.
 */
const SCROLL_BOTTOM_INSET = spacing.xxl + FAB_SIZE + spacing.lg;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  // The gap this carries used to sit on `header`, which has a single child —
  // so the eyebrow and the title were flush against each other.
  headerTitles: {
    gap: spacing.xxs,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    // Keeps the bell button clear of the floating hamburger (_layout.tsx),
    // which overlays the whole screen at a fixed top-right position rather
    // than living inside this header.
    paddingRight: HAMBURGER_CLEARANCE,
  },
  remindersToggle: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
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
    paddingBottom: SCROLL_BOTTOM_INSET,
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
