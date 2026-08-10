// Goals tab: filtered list (Active/Completed) with mark-complete and delete
// actions, plus the shared QuickAddSheet for title-only creation. Tapping a
// goal row (not the Done/Delete buttons) opens EditGoalSheet for full edit
// (title/category/target hours/deadline/color) — see
// src/components/EditGoalSheet.tsx.
//
// Visual language is ported from dw-time-web's goals page:
//   - src/features/goals/components/goal-item.tsx — the card itself: a
//     `border-l-[5px]` stripe in `goal.color`, a category eyebrow preceded by
//     a status dot, the title, and a progress block pinned to the bottom
//     showing `loggedHours.toFixed(1)h / targetHoursh` beside a big percent.
//     The bar + number pair is folded into one ProgressRing here (see
//     src/components/lists/ProgressRing.tsx for why).
//   - src/features/goals/components/goals-stats.tsx — the StatCard strip above
//     the list, reproduced as a scroll-away summary row.
//   - src/features/goals/components/goals-filters.tsx — the status filter,
//     which is a <Select> on web and a segmented control here.
//   - src/features/goals/components/goals-list.tsx:32-54 — the empty state's
//     title/description/CTA structure.

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import { calculateProgressPercent, updateGoalSchema, type Goal, type GoalStatus } from "@goalslot/shared";

import { EditGoalSheet, ErrorState, QuickAddSheet, SkeletonListItem, type EditGoalSheetRef } from "@/components";
import { Icon } from "@/components/ui/Icon";
import {
  ListCard,
  ListEmptyState,
  MetaChip,
  ProgressRing,
  safeColor,
  ScreenHeader,
  SegmentedControl,
  StatusPill,
} from "@/components/lists";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { goalQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

// The two tabs this screen offers. PAUSED goals (the third GoalStatus value)
// have no tab of their own in v1 — out of scope per the project brief.
type GoalTab = Extract<GoalStatus, "ACTIVE" | "COMPLETED">;

const TABS: { value: GoalTab; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETED", label: "Completed" },
];

const EMPTY_MESSAGE: Record<GoalTab, string> = {
  ACTIVE: "No active goals yet — add one to get started",
  COMPLETED: "No completed goals yet",
};

/** Supporting line under the empty-state headline — web goals-list.tsx:38-42. */
const EMPTY_DESCRIPTION: Record<GoalTab, string> = {
  ACTIVE: "Create your first goal to start tracking your progress. Log hours against it and watch the ring fill up.",
  COMPLETED: "Goals you finish will be archived here, with the hours you put into each one.",
};

const SKELETON_ROWS = 6;

/** Deadline as "Mar 4" — web formats with date-fns `MMM d, yyyy`; the year is
 *  dropped here because a phone chip has no room for it. */
function formatDeadline(deadline: string): string {
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return deadline;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function GoalsScreen() {
  const [tab, setTab] = useState<GoalTab>("ACTIVE");
  const analytics = useAnalytics();
  const quickAddRef = useRef<BottomSheetModal>(null);
  const editGoalRef = useRef<EditGoalSheetRef>(null);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "goals" } });
    }, [analytics]),
  );

  const filters = useMemo(() => ({ status: tab }), [tab]);
  // `isPending` (no cached data yet) drives the skeleton; a screen returning
  // to this tab with data already in the query cache renders instantly with
  // `isPending: false`, so no blocking skeleton flashes on cached-first loads.
  const { data, isPending, isError, isFetching, refetch } = useQuery(goalQueries.list(filters));

  // Both mutations below only ever touch the currently-viewed tab's list
  // query — the completed/deleted goal simply drops out of it. The
  // post-success `invalidateQueries` on `goalQueries.goalQueries.all`
  // reconciles the *other* tab (e.g. a completed goal reappearing under
  // Completed) against the server instead of hand-patching every cached key.
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
      <GoalRow goal={item} index={index} onComplete={handleComplete} onDelete={confirmDelete} onEdit={openEdit} />
    ),
    [confirmDelete, handleComplete, openEdit],
  );

  // Mirrors goals-stats.tsx's StatCard strip: the three numbers worth knowing
  // before you read any individual row. Scrolls away with the list rather
  // than permanently eating vertical space on a phone.
  const summary = useMemo(() => {
    if (!data || data.length === 0) return null;
    const logged = data.reduce((total, goal) => total + goal.loggedHours, 0);
    const target = data.reduce((total, goal) => total + goal.targetHours, 0);
    const averageProgress = Math.round(
      data.reduce((total, goal) => total + calculateProgressPercent(goal.loggedHours, goal.targetHours), 0) /
        data.length,
    );
    return { count: data.length, logged, target, averageProgress };
  }, [data]);

  const listHeader = useMemo(() => {
    if (!summary) return null;
    return (
      <View style={styles.summaryRow}>
        <SummaryStat label={summary.count === 1 ? "Goal" : "Goals"} value={String(summary.count)} />
        <View style={styles.summaryDivider} />
        <SummaryStat label="Logged" value={`${summary.logged.toFixed(1)}h`} />
        <View style={styles.summaryDivider} />
        <SummaryStat label="Avg" value={`${summary.averageProgress}%`} accent />
      </View>
    );
  }, [summary]);

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <View style={styles.skeletonWrap}>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} />
        ))}
      </View>
    );
  } else if (isError) {
    content = <ErrorState message="Couldn't load goals." onRetry={() => void refetch()} />;
  } else if (!data || data.length === 0) {
    content = (
      <ListEmptyState
        variant="goals"
        title={EMPTY_MESSAGE[tab]}
        description={EMPTY_DESCRIPTION[tab]}
        actionLabel={tab === "ACTIVE" ? "Create goal" : undefined}
        onAction={tab === "ACTIVE" ? openQuickAdd : undefined}
      />
    );
  } else {
    content = (
      <FlashList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        refreshing={isFetching}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    // edges={["top"]} — every route in app/(app)/_layout.tsx sets
    // `headerShown: false`, so without this the segmented control renders
    // underneath the status bar / notch.
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        eyebrow="Track"
        title="Goals"
        subtitle="Hours logged against what you said mattered."
        action={<SegmentedControl options={TABS} value={tab} onChange={setTab} />}
      />

      <View style={styles.listArea}>{content}</View>

      <Pressable
        style={styles.fab}
        onPress={openQuickAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add goal"
      >
        <Icon name="add" size={26} color={colors.primaryForeground} />
      </Pressable>

      <QuickAddSheet ref={quickAddRef} kind="goal" />
      <EditGoalSheet ref={editGoalRef} />
    </SafeAreaView>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryValue, accent && styles.summaryValueAccent]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

interface GoalRowProps {
  goal: Goal;
  index: number;
  onComplete: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
}

function GoalRow({ goal, index, onComplete, onDelete, onEdit }: GoalRowProps) {
  const progress = calculateProgressPercent(goal.loggedHours, goal.targetHours);
  const accent = safeColor(goal.color, colors.primary);
  const isActive = goal.status === "ACTIVE";

  return (
    <ListCard
      accentColor={accent}
      index={index}
      dimmed={!isActive}
      onPress={() => onEdit(goal)}
      accessibilityLabel={`Edit "${goal.title}"`}
    >
      <View style={styles.rowTop}>
        <ProgressRing
          progress={progress}
          color={accent}
          accessibilityLabel={`${progress} percent of "${goal.title}" complete`}
        />

        <View style={styles.rowBody}>
          {/* Eyebrow: status dot + category, exactly the pairing in
              goal-item.tsx:66-79. */}
          <View style={styles.eyebrowRow}>
            <View
              style={[styles.statusDot, { backgroundColor: isActive ? colors.success : colors.mutedForeground }]}
            />
            <Text style={styles.category} numberOfLines={1}>
              {goal.category}
            </Text>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {goal.title}
          </Text>

          {/* goal-item.tsx:132-135 — logged hours bold, target muted beside it. */}
          <Text style={styles.hours}>
            {goal.loggedHours.toFixed(1)}h<Text style={styles.hoursTarget}> / {goal.targetHours}h</Text>
          </Text>
        </View>
      </View>

      {goal.deadline || (goal.labels && goal.labels.length > 0) ? (
        <View style={styles.chipRow}>
          {goal.deadline ? (
            <MetaChip icon="schedule" tone="warning" label={`Due ${formatDeadline(goal.deadline)}`} />
          ) : null}
          {/* goal-item.tsx:108-120 caps the label list at four. */}
          {(goal.labels ?? []).slice(0, 4).map((goalLabel) => (
            <MetaChip key={goalLabel.label.id} label={goalLabel.label.name} accentColor={goalLabel.label.color} />
          ))}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {isActive ? (
          <Pressable
            style={styles.completeButton}
            onPress={() => onComplete(goal)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Mark "${goal.title}" complete`}
          >
            <Icon name="check" size={15} color={colors.success} />
            <Text style={styles.completeButtonText}>Done</Text>
          </Pressable>
        ) : (
          <StatusPill label="Completed" tone="success" />
        )}

        <Pressable
          style={styles.deleteButton}
          onPress={() => onDelete(goal)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete "${goal.title}"`}
        >
          <Icon name="trash" size={16} color={colors.destructive} />
        </Pressable>
      </View>
    </ListCard>
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

  // --- Summary strip (web: goals-stats.tsx StatCard row) ---
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryStat: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xxs,
  },
  summaryValue: {
    ...typography.title,
    color: colors.foreground,
  },
  summaryValueAccent: {
    color: colors.primaryDark,
  },
  summaryLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  summaryDivider: {
    width: 1,
    height: 26,
    backgroundColor: colors.border,
  },

  // --- Goal card ---
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  category: {
    ...typography.label,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  title: {
    ...typography.title,
    color: colors.foreground,
    lineHeight: 21,
  },
  hours: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.foreground,
    marginTop: spacing.xxs,
  },
  hoursTarget: {
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  completeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget - spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.successMuted,
  },
  completeButtonText: {
    ...typography.caption,
    color: colors.success,
  },
  deleteButton: {
    width: minTouchTarget - spacing.xs,
    height: minTouchTarget - spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
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
