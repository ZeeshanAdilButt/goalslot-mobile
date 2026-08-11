// Goals tab: status-filtered list with mark-complete and delete actions, plus
// the shared QuickAddSheet for title-only creation. Tapping a goal row (not
// the Done/Delete buttons) opens EditGoalSheet for the full edit
// (title/category/target hours/deadline/status/color) — see
// src/components/EditGoalSheet.tsx.
//
// Visual language is ported from dw-time-web's goals page:
//   - src/features/goals/components/goals-filters.tsx:41-52 — the status
//     filter. Web offers ACTIVE / COMPLETED / PAUSED in a <Select>; this is
//     the same three as a segmented control, because hiding a short fixed
//     list behind a tap is pointless on a phone. PAUSED used to be missing
//     here entirely, which meant a goal paused on web simply vanished from
//     the phone with no tab showing it and no control to bring it back.
//   - src/features/goals/components/goals-stats.tsx — the StatCard strip
//     above the list, reproduced as a scroll-away summary row, and the
//     Active/Paused/Completed counts, which ride on the segments themselves
//     rather than costing three more tiles.
//   - src/features/goals/components/goals-list.tsx:32-54 — the empty state's
//     title/description/CTA structure.
//   - src/features/goals/components/goal-item.tsx — the card itself; see
//     src/components/goals/GoalCard.tsx.

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import {
  GOAL_STATUS_OPTIONS,
  getLocalDateString,
  updateGoalSchema,
  type Goal,
  type GoalStatus,
} from "@goalslot/shared";

import { EditGoalSheet, ErrorState, QuickAddSheet, Skeleton, SkeletonCard, type EditGoalSheetRef } from "@/components";
import { Icon } from "@/components/ui/Icon";
import { GoalCard, GoalsSummary, summariseGoals, SUMMARY_HEIGHT } from "@/components/goals";
import { ListEmptyState, ScreenHeader, SegmentedControl, type SegmentOption } from "@/components/lists";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { goalQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

/** Lower-case name of each tab, for the summary strip and empty copy. */
const STATUS_WORD: Record<GoalStatus, string> = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
};

const EMPTY_TITLE: Record<GoalStatus, string> = {
  ACTIVE: "No active goals yet",
  PAUSED: "Nothing on hold",
  COMPLETED: "No completed goals yet",
};

/** Supporting line under the empty-state headline — web goals-list.tsx:38-42. */
const EMPTY_DESCRIPTION: Record<GoalStatus, string> = {
  ACTIVE: "Create your first goal to start tracking your progress. Log hours against it and watch the ring fill up.",
  PAUSED: "Goals you set aside land here, holding their hours until you pick them back up.",
  COMPLETED: "Goals you finish will be archived here, with the hours you put into each one.",
};

const SKELETON_ROWS = 5;

export default function GoalsScreen() {
  const [tab, setTab] = useState<GoalStatus>("ACTIVE");
  const analytics = useAnalytics();
  const quickAddRef = useRef<BottomSheetModal>(null);
  const editGoalRef = useRef<EditGoalSheetRef>(null);

  // Today, as a "YYYY-MM-DD" key. Every row is handed the same value so a
  // long list can't disagree with itself about whether a deadline is overdue.
  // Refreshed on focus rather than on a timer: the app sitting open past
  // midnight is the only way this goes stale, and returning to the tab is the
  // next thing that happens after that. Setting the same string is a React
  // bailout, so this costs nothing on a normal focus.
  const [todayKey, setTodayKey] = useState(() => getLocalDateString());

  useFocusEffect(
    useCallback(() => {
      setTodayKey(getLocalDateString());
      analytics.track({ name: "screenViewed", payload: { screenName: "goals" } });
    }, [analytics]),
  );

  const filters = useMemo(() => ({ status: tab }), [tab]);
  // `isPending` (no cached data yet) drives the skeleton; a screen returning
  // to this tab with data already in the query cache renders instantly with
  // `isPending: false`, so no blocking skeleton flashes on cached-first loads.
  // Never `isLoading`/`isFetching` here — both are true on a background
  // revalidation and would blank a perfectly good list on every revisit.
  const { data, isPending, isError, isFetching, refetch } = useQuery(goalQueries.list(filters));

  // Web spends three StatCards on these counts (goals-stats.tsx:40-44). One
  // extra query, and deliberately not part of any loading gate: if /goals/stats
  // is slow or fails, the segments simply render without their badges instead
  // of holding up the list.
  const statsQuery = useQuery(goalQueries.stats());

  // GOAL_STATUS_OPTIONS (packages/shared/src/types/goal.ts) is the same
  // ACTIVE / PAUSED / COMPLETED list, in the same order, that web feeds its
  // status <Select> — reused rather than re-typed so the two can't drift.
  const tabOptions = useMemo<SegmentOption<GoalStatus>[]>(() => {
    const stats = statsQuery.data;
    return GOAL_STATUS_OPTIONS.map((entry) => ({
      ...entry,
      count:
        stats === undefined
          ? undefined
          : entry.value === "ACTIVE"
            ? stats.active
            : entry.value === "PAUSED"
              ? stats.paused
              : stats.completed,
    }));
  }, [statsQuery.data]);

  // Both mutations below only ever touch the currently-viewed tab's list
  // query — the completed/deleted goal simply drops out of it. The
  // post-success `invalidateQueries` on `goalQueries.goalQueries.all`
  // reconciles the *other* tabs (e.g. a completed goal reappearing under
  // Completed, and the stats counts) against the server instead of
  // hand-patching every cached key.
  const listKey = useMemo(() => goalQueries.goalQueries.list(filters), [filters]);

  const removeFromCurrentList = useCallback(
    (goalId: string): Goal[] | undefined => {
      const previous = queryClient.getQueryData<Goal[]>(listKey);
      queryClient.setQueryData<Goal[]>(listKey, (existing) => (existing ?? []).filter((g) => g.id !== goalId));
      return previous;
    },
    [listKey],
  );

  const handleComplete = useCallback(
    async (goal: Goal) => {
      const previous = removeFromCurrentList(goal.id);
      try {
        const payload = updateGoalSchema.parse({ status: "COMPLETED" });
        await apiClient.goals.update(goal.id, payload);
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
        hapticCompletion();
        analytics.track({ name: "goalCompleted", payload: { goalId: goal.id } });
      } catch {
        queryClient.setQueryData(listKey, previous);
        Alert.alert("Couldn't complete goal", "Please try again.");
      }
    },
    [analytics, listKey, removeFromCurrentList],
  );

  const deleteGoal = useCallback(
    async (goal: Goal) => {
      const previous = removeFromCurrentList(goal.id);
      try {
        await apiClient.goals.delete(goal.id);
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
        analytics.track({ name: "goalDeleted", payload: { goalId: goal.id } });
      } catch {
        queryClient.setQueryData(listKey, previous);
        Alert.alert("Couldn't delete goal", "Please try again.");
      }
    },
    [analytics, listKey, removeFromCurrentList],
  );

  const confirmDelete = useCallback(
    (goal: Goal) => {
      Alert.alert("Delete goal?", `"${goal.title}" will be permanently removed.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteGoal(goal) },
      ]);
    },
    [deleteGoal],
  );

  const openEdit = useCallback((goal: Goal) => {
    editGoalRef.current?.present(goal);
  }, []);

  const openQuickAdd = useCallback(() => {
    quickAddRef.current?.present();
  }, []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Goal>) => (
      <GoalCard
        goal={item}
        index={index}
        todayKey={todayKey}
        onComplete={handleComplete}
        onDelete={confirmDelete}
        onEdit={openEdit}
      />
    ),
    [confirmDelete, handleComplete, openEdit, todayKey],
  );

  const goals = data ?? [];
  const summary = useMemo(() => summariseGoals(data), [data]);

  const listHeader = useMemo(() => {
    if (!summary) return null;
    return (
      <>
        {/* A failed background refetch must not take the screen away: the
            cached list below is still the last thing the server said, so the
            failure is reported as a retry strip above it instead of replacing
            real content with an error page. */}
        {isError ? <StaleNotice onRetry={() => void refetch()} /> : null}
        <GoalsSummary data={summary} statusLabel={STATUS_WORD[tab]} />
      </>
    );
  }, [isError, refetch, summary, tab]);

  // A failure only takes over the screen when there is nothing cached to show
  // (`!data`); with cached goals in hand the list stays and StaleNotice
  // reports the failure instead.
  const showError = isError && !data;
  const showEmpty = !isPending && !showError && goals.length === 0;
  // Only the Active tab's empty state carries a CTA (web does the same —
  // goals-list.tsx:44-52), and where it does, the FAB is hidden: both do the
  // exact same thing and the FAB's fixed bottom-right position lands on top
  // of the centred CTA. Same fix as commit 2d1806c on the Schedule tab.
  const emptyStateHasCta = showEmpty && tab === "ACTIVE";

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <View style={styles.skeletonWrap}>
        {/* Reserves the summary strip's exact height so the rows below don't
            jump down when real data lands. */}
        <Skeleton width="100%" height={SUMMARY_HEIGHT} borderRadius={radii.lg} style={styles.summarySkeleton} />
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          // SkeletonCard, not SkeletonListItem: Skeleton.tsx:152-159 says it
          // was written for "the elevated-card row shape goals.tsx renders",
          // and this screen was the one place still using the thin variant, so
          // the placeholder read as a different list than the one that arrived.
          <SkeletonCard key={index} />
        ))}
      </View>
    );
  } else if (showError) {
    content = <ErrorState message="Couldn't load goals." onRetry={() => void refetch()} />;
  } else if (showEmpty) {
    content = (
      <ListEmptyState
        variant="goals"
        title={EMPTY_TITLE[tab]}
        description={EMPTY_DESCRIPTION[tab]}
        actionLabel={tab === "ACTIVE" ? "Create goal" : undefined}
        onAction={tab === "ACTIVE" ? openQuickAdd : undefined}
      />
    );
  } else {
    content = (
      <FlashList
        data={goals}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        // `&& !isPending` so the initial load shows the skeleton alone; without
        // it the pull-to-refresh spinner rides on top of the skeleton and the
        // screen reads as loading twice.
        refreshing={isFetching && !isPending}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    // edges={["top"]} — every route in app/(app)/_layout.tsx sets
    // `headerShown: false`, so without this the header renders underneath the
    // status bar / notch. ScreenHeader then reserves the right-hand gutter for
    // the layout's floating hamburger and drops the segmented control onto its
    // own row below the title, which is what keeps either from colliding with
    // that button.
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        eyebrow="Track"
        title="Goals"
        subtitle="Hours logged against what you said mattered."
        action={<SegmentedControl options={tabOptions} value={tab} onChange={setTab} />}
      />

      <View style={styles.listArea}>{content}</View>

      {emptyStateHasCta ? null : (
        <Pressable
          style={styles.fab}
          onPress={openQuickAdd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add goal"
          accessibilityHint="Opens the quick-add sheet"
        >
          <Icon name="add" size={26} color={colors.primaryForeground} />
        </Pressable>
      )}

      <QuickAddSheet ref={quickAddRef} kind="goal" />
      <EditGoalSheet ref={editGoalRef} />
    </SafeAreaView>
  );
}

/**
 * Shown above a list that is still rendering cached goals after a refetch
 * failed. `alert` stands in for a wifi-off glyph, which the icon set doesn't
 * carry yet (flagged in the handover).
 */
function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable
      style={styles.staleNotice}
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Couldn't refresh goals. Showing the last saved copy."
      accessibilityHint="Tap to try again"
    >
      <Icon name="alert" size={14} color={colors.warning} />
      <Text style={styles.staleNoticeText} numberOfLines={1}>
        Couldn&apos;t refresh — showing saved goals
      </Text>
      <Icon name="refresh" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listArea: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    // Clears the tab bar and the FAB.
    paddingBottom: spacing.xxxl * 3,
  },
  skeletonWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  summarySkeleton: {
    marginBottom: spacing.md,
  },

  staleNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warningMuted,
    backgroundColor: colors.warningMuted,
  },
  staleNoticeText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },

  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.fab,
  },
});
