// Tasks screen: swipe-left-to-reveal-complete, swipe-right-to-reveal
// reschedule/delete, tap-the-row-to-edit. All mutations follow the same
// optimistic-patch -> live call -> invalidate-or-rollback shape as
// src/hooks/useQuickAdd.ts, just inlined here (this file is the only one
// this task is scoped to touch) instead of factored into a shared hook. The
// row-tap edit flow (title/category/due date/estimated minutes) opens
// src/components/EditTaskSheet.tsx, which follows the same shape itself.

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import { getLocalDateString, type CompleteTaskInput, type Task, type UpdateTaskInput } from "@goalslot/shared";

import { EditTaskSheet, type EditTaskSheetRef } from "@/components/EditTaskSheet";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { QuickAddSheet } from "@/components/QuickAddSheet";
import { SkeletonListItem } from "@/components/Skeleton";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { taskQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const SKELETON_ROW_COUNT = 6;
const SWIPE_ACTION_WIDTH = 92;

/** Incomplete tasks first, DONE tasks sink to the bottom; stable otherwise. */
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE"));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const RESCHEDULE_OPTIONS: Array<{ label: string; daysFromToday: number }> = [
  { label: "Today", daysFromToday: 0 },
  { label: "Tomorrow", daysFromToday: 1 },
  { label: "Next week", daysFromToday: 7 },
];

export default function TasksScreen() {
  const analytics = useAnalytics();
  const listQueryKey = taskQueries.taskQueries.list();

  const { data: tasks, isPending, isError, error, isFetching, refetch } = useQuery(taskQueries.list());

  const sortedTasks = useMemo(() => sortTasks(tasks ?? []), [tasks]);

  const quickAddSheetRef = useRef<BottomSheetModal>(null);
  const rescheduleSheetRef = useRef<BottomSheetModal>(null);
  const editTaskRef = useRef<EditTaskSheetRef>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Task | null>(null);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "tasks" } });
    }, [analytics]),
  );

  // Snapshot-based rollback: capture the list as it was right before the
  // optimistic patch, and if the live call fails, restore that exact
  // snapshot rather than trying to reverse-compute the patch.
  const patchTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      const previous = queryClient.getQueryData<Task[]>(listQueryKey);
      queryClient.setQueryData<Task[]>(listQueryKey, (existing) =>
        (existing ?? []).map((task) => (task.id === id ? { ...task, ...patch } : task)),
      );
      return previous;
    },
    [listQueryKey],
  );

  const removeTask = useCallback(
    (id: string) => {
      const previous = queryClient.getQueryData<Task[]>(listQueryKey);
      queryClient.setQueryData<Task[]>(listQueryKey, (existing) => (existing ?? []).filter((task) => task.id !== id));
      return previous;
    },
    [listQueryKey],
  );

  const restoreSnapshot = useCallback(
    (previous: Task[] | undefined) => {
      queryClient.setQueryData<Task[]>(listQueryKey, previous);
    },
    [listQueryKey],
  );

  const handleComplete = useCallback(
    async (task: Task) => {
      if (task.status === "DONE") return;

      // The swipe gesture can't collect `actualMinutes` (the live endpoint
      // requires it, min 1) without turning a one-tap gesture into a form,
      // which defeats the point of swipe-to-complete. Default to the task's
      // own estimate, falling back to the schema's minimum of 1 — a real
      // number the user can still correct later via the (separate) edit
      // flow, not a placeholder that fails validation.
      const payload: CompleteTaskInput = { actualMinutes: task.estimatedMinutes ?? 1 };

      const previous = patchTask(task.id, { status: "DONE", completedAt: new Date().toISOString() });

      try {
        await apiClient.tasks.complete(task.id, payload);
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
        hapticCompletion();
        analytics.track({ name: "taskCompleted", payload: { taskId: task.id } });
      } catch {
        restoreSnapshot(previous);
        Alert.alert("Couldn't complete task", "Please try again.");
      }
    },
    [analytics, patchTask, restoreSnapshot],
  );

  const handleDelete = useCallback(
    async (task: Task) => {
      const previous = removeTask(task.id);

      try {
        await apiClient.tasks.delete(task.id);
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
        analytics.track({ name: "taskDeleted", payload: { taskId: task.id } });
      } catch {
        restoreSnapshot(previous);
        Alert.alert("Couldn't delete task", "Please try again.");
      }
    },
    [analytics, removeTask, restoreSnapshot],
  );

  const handleReschedule = useCallback(
    async (task: Task, dueDate: string) => {
      const payload: UpdateTaskInput = { dueDate };
      const previous = patchTask(task.id, { dueDate });

      try {
        await apiClient.tasks.update(task.id, payload);
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      } catch {
        restoreSnapshot(previous);
        Alert.alert("Couldn't reschedule task", "Please try again.");
      }
    },
    [patchTask, restoreSnapshot],
  );

  const openReschedule = useCallback((task: Task) => {
    setRescheduleTarget(task);
    rescheduleSheetRef.current?.present();
  }, []);

  const pickRescheduleDate = useCallback(
    (daysFromToday: number) => {
      if (!rescheduleTarget) return;
      void handleReschedule(rescheduleTarget, getLocalDateString(addDays(new Date(), daysFromToday)));
      rescheduleSheetRef.current?.dismiss();
      setRescheduleTarget(null);
    },
    [handleReschedule, rescheduleTarget],
  );

  const openQuickAdd = useCallback(() => {
    quickAddSheetRef.current?.present();
  }, []);

  const openEdit = useCallback((task: Task) => {
    editTaskRef.current?.present(task);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Task>) => (
      <TaskRow
        task={item}
        onComplete={handleComplete}
        onDelete={handleDelete}
        onReschedule={openReschedule}
        onEdit={openEdit}
      />
    ),
    [handleComplete, handleDelete, openEdit, openReschedule],
  );

  if (isPending) {
    return (
      <View style={styles.container}>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <SkeletonListItem key={index} showLeading={false} />
        ))}
      </View>
    );
  }

  if (isError && !tasks) {
    return (
      <View style={styles.container}>
        <ErrorState message={error instanceof Error ? error.message : "Couldn't load tasks."} onRetry={refetch} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {sortedTasks.length === 0 ? (
        <EmptyState message="No tasks yet — add one" actionLabel="Add task" onAction={openQuickAdd} />
      ) : (
        <FlashList
          data={sortedTasks}
          renderItem={renderItem}
          keyExtractor={(task) => task.id}
          refreshing={isFetching && !isPending}
          onRefresh={refetch}
          contentContainerStyle={styles.listContent}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={openQuickAdd}
        accessibilityRole="button"
        accessibilityLabel="Add task"
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <QuickAddSheet ref={quickAddSheetRef} kind="task" />
      <EditTaskSheet ref={editTaskRef} />

      <BottomSheetModal ref={rescheduleSheetRef} snapPoints={RESCHEDULE_SNAP_POINTS} enablePanDownToClose>
        <BottomSheetView style={styles.rescheduleContent}>
          <Text style={styles.rescheduleTitle}>Reschedule {rescheduleTarget?.title ?? "task"}</Text>
          {RESCHEDULE_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.label}
              style={styles.rescheduleOption}
              onPress={() => pickRescheduleDate(option.daysFromToday)}
              accessibilityRole="button"
              accessibilityLabel={`Reschedule to ${option.label}`}
            >
              <Text style={styles.rescheduleOptionText}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}

const RESCHEDULE_SNAP_POINTS = ["35%"];

interface TaskRowProps {
  task: Task;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
  onReschedule: (task: Task) => void;
  onEdit: (task: Task) => void;
}

function TaskRow({ task, onComplete, onDelete, onReschedule, onEdit }: TaskRowProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const isDone = task.status === "DONE";

  const renderLeftActions = useCallback(() => {
    if (isDone) return null;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, styles.completeAction]}
        onPress={() => {
          swipeableRef.current?.close();
          onComplete(task);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Complete "${task.title}"`}
      >
        <Text style={styles.swipeActionText}>Complete</Text>
      </TouchableOpacity>
    );
  }, [isDone, onComplete, task]);

  const renderRightActions = useCallback(
    () => (
      <View style={styles.swipeActionsRow}>
        <TouchableOpacity
          style={[styles.swipeAction, styles.rescheduleAction]}
          onPress={() => {
            swipeableRef.current?.close();
            onReschedule(task);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Reschedule "${task.title}"`}
        >
          <Text style={styles.swipeActionText}>Reschedule</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.swipeAction, styles.deleteAction]}
          onPress={() => {
            swipeableRef.current?.close();
            onDelete(task);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete "${task.title}"`}
        >
          <Text style={styles.swipeActionText}>Delete</Text>
        </TouchableOpacity>
      </View>
    ),
    [onDelete, onReschedule, task],
  );

  return (
    <Swipeable ref={swipeableRef} renderLeftActions={renderLeftActions} renderRightActions={renderRightActions}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => onEdit(task)}
        accessibilityRole="button"
        accessibilityLabel={`Edit "${task.title}"`}
      >
        <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {[task.category, task.dueDate, task.estimatedMinutes ? `${task.estimatedMinutes}m` : null]
            .filter(Boolean)
            .join(" · ") || "No details"}
        </Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowTitleDone: {
    textDecorationLine: "line-through",
    opacity: 0.5,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  swipeActionsRow: {
    flexDirection: "row",
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  completeAction: {
    backgroundColor: colors.success,
  },
  rescheduleAction: {
    backgroundColor: colors.foreground,
  },
  deleteAction: {
    backgroundColor: colors.destructive,
  },
  swipeActionText: {
    color: colors.white,
    fontWeight: "600",
    fontSize: 13,
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
  fabText: {
    color: colors.primaryForeground,
    fontSize: 28,
    lineHeight: 30,
  },
  rescheduleContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  rescheduleTitle: {
    ...typography.h2,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  rescheduleOption: {
    paddingVertical: spacing.md,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.secondary,
    alignItems: "center",
  },
  rescheduleOptionText: {
    ...typography.body,
    color: colors.foreground,
  },
});
