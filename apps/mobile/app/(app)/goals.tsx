// Goals tab: filtered list (Active/Completed) with mark-complete and delete
// actions, plus the shared QuickAddSheet for title-only creation. Tapping a
// goal row (not the Done/Delete buttons) opens EditGoalSheet for full edit
// (title/category/target hours/deadline/color) — see
// src/components/EditGoalSheet.tsx.

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import { calculateProgressPercent, updateGoalSchema, type Goal, type GoalStatus } from "@goalslot/shared";

import { EditGoalSheet, EmptyState, ErrorState, QuickAddSheet, SkeletonListItem, type EditGoalSheetRef } from "@/components";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { goalQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";

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

const SKELETON_ROWS = 6;

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

  const renderItem = useCallback(
    ({ item }: { item: Goal }) => (
      <GoalRow goal={item} onComplete={handleComplete} onDelete={confirmDelete} onEdit={openEdit} />
    ),
    [confirmDelete, handleComplete, openEdit],
  );

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <View>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} />
        ))}
      </View>
    );
  } else if (isError) {
    content = <ErrorState message="Couldn't load goals." onRetry={() => void refetch()} />;
  } else if (!data || data.length === 0) {
    content = <EmptyState message={EMPTY_MESSAGE[tab]} />;
  } else {
    content = (
      <FlashList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshing={isFetching}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <Pressable
            key={t.value}
            style={[styles.tabButton, tab === t.value && styles.tabButtonActive]}
            onPress={() => setTab(t.value)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tab === t.value }}
          >
            <Text style={[styles.tabLabel, tab === t.value && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.listArea}>{content}</View>

      <Pressable
        style={styles.fab}
        onPress={() => quickAddRef.current?.present()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add goal"
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      <QuickAddSheet ref={quickAddRef} kind="goal" />
      <EditGoalSheet ref={editGoalRef} />
    </View>
  );
}

interface GoalRowProps {
  goal: Goal;
  onComplete: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
}

function GoalRow({ goal, onComplete, onDelete, onEdit }: GoalRowProps) {
  const progress = calculateProgressPercent(goal.loggedHours, goal.targetHours);
  const progressWidth: DimensionValue = `${progress}%`;

  return (
    <Pressable
      style={styles.row}
      onPress={() => onEdit(goal)}
      accessibilityRole="button"
      accessibilityLabel={`Edit "${goal.title}"`}
    >
      <View style={[styles.colorDot, { backgroundColor: goal.color || "#94A3B8" }]} />

      <View style={styles.rowBody}>
        <Text style={styles.title} numberOfLines={1}>
          {goal.title}
        </Text>
        <Text style={styles.category} numberOfLines={1}>
          {goal.category}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
        <Text style={styles.progressLabel}>
          {goal.loggedHours}h / {goal.targetHours}h &middot; {progress}%
        </Text>
      </View>

      <View style={styles.actions}>
        {goal.status === "ACTIVE" ? (
          <Pressable
            style={styles.completeButton}
            onPress={() => onComplete(goal)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Mark "${goal.title}" complete`}
          >
            <Text style={styles.completeButtonText}>Done</Text>
          </Pressable>
        ) : (
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>Completed</Text>
          </View>
        )}
        <Pressable
          style={styles.deleteButton}
          onPress={() => onDelete(goal)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete "${goal.title}"`}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#F1F5F9",
  },
  tabButtonActive: {
    backgroundColor: "#1F2933",
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
  tabLabelActive: {
    color: "#FFFFFF",
  },
  listArea: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
  },
  category: {
    fontSize: 12,
    color: "#64748B",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
    marginTop: 2,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: "#1F2933",
  },
  progressLabel: {
    fontSize: 11,
    color: "#94A3B8",
  },
  actions: {
    alignItems: "flex-end",
    gap: 6,
  },
  completeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#DCFCE7",
  },
  completeButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#166534",
  },
  statusBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#E2E8F0",
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  deleteButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  deleteButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#B3261E",
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1F2933",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabIcon: {
    fontSize: 28,
    lineHeight: 28,
    color: "#FFFFFF",
    fontWeight: "400",
  },
});
