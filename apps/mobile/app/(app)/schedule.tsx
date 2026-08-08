// Mobile's schedule screen is a day-by-day agenda list, not the web app's
// 7-day drag grid — see packages/shared/src/scheduling/grid.ts's header
// comment and dw-time-mobile/DECISIONS.md #5. This screen is intentionally
// thin: all time math (sorting, formatting) comes from
// packages/shared/src/scheduling, the only local logic is wiring the query
// cache and the swipe-to-delete gesture.

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import {
  DAYS_OF_WEEK,
  DAYS_OF_WEEK_FULL,
  formatTime12h,
  timeToMinutes,
  type ScheduleBlock,
  type WeekSchedule,
} from "@goalslot/shared";

import { EmptyState, ErrorState, QuickAddSheet, SkeletonListItem } from "@/components";
import { apiClient } from "@/lib/api-client";
import { hapticLight } from "@/lib/haptics";
import { scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

// Sunday=0 ... Saturday=6, matching Date.getDay() / WeekSchedule's keys —
// fixed at module load since "today" doesn't change during a screen's life.
const TODAY_INDEX = new Date().getDay();
const SKELETON_ROW_COUNT = 5;

export default function ScheduleScreen() {
  const analytics = useAnalytics();
  const [selectedDay, setSelectedDay] = useState(TODAY_INDEX);
  const quickAddRef = useRef<BottomSheetModal>(null);

  // expo-router re-exports react-navigation's useFocusEffect directly (see
  // node_modules/expo-router/build/useFocusEffect.js) — no extra dependency
  // needed. Fires on every tab return, not just the first mount, matching
  // the other v1 screens' screenViewed timing.
  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "schedule" } });
    }, [analytics]),
  );

  const weeklyQuery = useQuery(scheduleQueries.weekly());

  // Cached-first: `isPending` (data === undefined) already reflects "nothing
  // to show yet" whether that's a cold first load or an empty persisted
  // cache — unlike `isLoading`, it stays false once persisted/cached data
  // exists even while a background refetch is in flight, so a revisit never
  // flashes a blocking skeleton over data that's already on screen.
  const showSkeleton = weeklyQuery.isPending;

  const dayBlocks = useMemo(() => {
    const blocks = weeklyQuery.data?.[selectedDay] ?? [];
    return [...blocks].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  }, [weeklyQuery.data, selectedDay]);

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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ScheduleBlock>) => <BlockRow block={item} onDelete={handleDeleteBlock} />,
    [handleDeleteBlock],
  );

  return (
    <View style={styles.container}>
      <DaySelector selectedDay={selectedDay} onSelectDay={setSelectedDay} />

      <View style={styles.listContainer}>
        {showSkeleton ? (
          <View>
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
              <SkeletonListItem key={index} />
            ))}
          </View>
        ) : weeklyQuery.isError ? (
          <ErrorState
            message="Couldn't load your schedule."
            onRetry={() => {
              void weeklyQuery.refetch();
            }}
          />
        ) : (
          <FlashList
            data={dayBlocks}
            keyExtractor={(block) => block.id}
            renderItem={renderItem}
            refreshing={weeklyQuery.isFetching && !weeklyQuery.isPending}
            onRefresh={() => {
              void weeklyQuery.refetch();
            }}
            ListEmptyComponent={
              <EmptyState message={`Nothing scheduled for ${DAYS_OF_WEEK_FULL[selectedDay]} — add something`} />
            }
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      <Pressable style={styles.fab} onPress={openQuickAdd} accessibilityRole="button" accessibilityLabel="Add time slot">
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      <QuickAddSheet ref={quickAddRef} kind="slot" />
    </View>
  );
}

interface DaySelectorProps {
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

function DaySelector({ selectedDay, onSelectDay }: DaySelectorProps) {
  return (
    <View style={styles.dayRow}>
      {DAYS_OF_WEEK.map((label, index) => {
        const isSelected = index === selectedDay;
        const isToday = index === TODAY_INDEX;
        return (
          <Pressable
            key={label}
            onPress={() => onSelectDay(index)}
            style={[styles.dayPill, isSelected && styles.dayPillSelected]}
            accessibilityRole="button"
            accessibilityLabel={DAYS_OF_WEEK_FULL[index]}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.dayPillText, isSelected && styles.dayPillTextSelected]}>{label}</Text>
            {isToday ? <View style={[styles.todayDot, isSelected && styles.todayDotSelected]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

interface BlockRowProps {
  block: ScheduleBlock;
  onDelete: (block: ScheduleBlock) => void;
}

function BlockRow({ block, onDelete }: BlockRowProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);

  const handleDeletePress = useCallback(() => {
    swipeableRef.current?.close();
    onDelete(block);
  }, [block, onDelete]);

  const renderRightActions = useCallback(
    () => <DeleteAction onPress={handleDeletePress} />,
    [handleDeletePress],
  );

  return (
    <Swipeable ref={swipeableRef} renderRightActions={renderRightActions} overshootRight={false} rightThreshold={40}>
      <View style={styles.row}>
        <View style={[styles.colorDot, { backgroundColor: block.color }]} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {block.title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {formatTime12h(block.startTime)} – {formatTime12h(block.endTime)}
            {block.category ? ` · ${block.category}` : ""}
          </Text>
        </View>
      </View>
    </Swipeable>
  );
}

function DeleteAction({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.deleteAction}>
      <Pressable onPress={onPress} style={styles.deleteButton} accessibilityRole="button" accessibilityLabel="Delete">
        <Text style={styles.deleteButtonText}>Delete</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  dayPill: {
    flex: 1,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayPillSelected: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  dayPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  dayPillTextSelected: {
    color: colors.white,
  },
  todayDot: {
    marginTop: spacing.xxs,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  todayDotSelected: {
    backgroundColor: colors.primary,
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.title,
    color: colors.foreground,
  },
  rowMeta: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  deleteAction: {
    width: 88,
    justifyContent: "center",
    alignItems: "stretch",
    marginBottom: spacing.md,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.destructive,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.lg,
  },
  deleteButtonText: {
    color: colors.white,
    fontWeight: "600",
    fontSize: 14,
  },
  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.fab,
  },
  fabIcon: {
    color: colors.primaryForeground,
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 30,
  },
});
