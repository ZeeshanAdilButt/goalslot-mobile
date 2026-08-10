// Tasks screen: swipe-left-to-reveal-complete, swipe-right-to-reveal
// reschedule/delete, tap-the-row-to-edit. All mutations follow the same
// optimistic-patch -> live call -> invalidate-or-rollback shape as
// src/hooks/useQuickAdd.ts, just inlined here (this file is the only one
// this task is scoped to touch) instead of factored into a shared hook. The
// row-tap edit flow (title/category/due date/estimated minutes) opens
// src/components/EditTaskSheet.tsx, which follows the same shape itself.
//
// Layout is ported from dw-time-web's task list:
//   - src/features/tasks/components/task-list.tsx:18-32 — the list is GROUPED
//     BY STATUS with a header carrying the group name and a count pill, and
//     the DONE group is visually demoted. That replaces the flat
//     "incomplete first, DONE sinks to the bottom" sort this screen used to
//     do by hand; grouping keeps that ordering property (DONE is the last
//     group) and adds the structure the web has.
//   - src/features/tasks/components/task-list-item/task-list-item.tsx:47 —
//     card with a status-colored left border.
//   - .../task-header.tsx:16-30 — status dot beside a bold title.
//   - .../task-metadata.tsx — the row of category / goal / schedule / due-date
//     chips, including the goal chip tinted from the goal's own color.
//   - .../task-complete-button.tsx — completion as a first-class control.
//     On web that's a full-width footer button; here it's the springy
//     checkbox on the left of the row (see components/lists/CompleteCheckbox),
//     because a thumb scanning a list needs the primary action under it, not
//     at the bottom of each card.

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import {
  formatDuration,
  formatTime12h,
  getLocalDateString,
  type CompleteTaskInput,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
} from "@goalslot/shared";

import { EditTaskSheet, type EditTaskSheetRef } from "@/components/EditTaskSheet";
import { ErrorState } from "@/components/ErrorState";
import { QuickAddSheet } from "@/components/QuickAddSheet";
import { SkeletonListItem } from "@/components/Skeleton";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  CompleteCheckbox,
  ListCard,
  ListEmptyState,
  MetaChip,
  ScreenHeader,
  SectionHeader,
  taskStatusLabel,
  taskStatusTone,
  TONES,
} from "@/components/lists";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { taskQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const SKELETON_ROW_COUNT = 6;
const SWIPE_ACTION_WIDTH = 92;

/**
 * Horizontal rail the completion checkbox occupies, so the metadata chips on
 * the second line start exactly under the title rather than under the
 * checkbox. The checkbox is a `minTouchTarget`-wide hit area pulled `spacing.sm`
 * into the card's padding, then `spacing.md` of gap before the title.
 */
const CHECKBOX_RAIL = minTouchTarget - spacing.sm + spacing.md;

/**
 * Group order, copied verbatim from dw-time-web's `groupTasksByStatus`
 * (src/features/tasks/utils/utils.ts:6-19) — the object literal's key order IS
 * the render order there. DONE last preserves this screen's previous
 * "completed tasks sink to the bottom" behaviour.
 */
const STATUS_ORDER: TaskStatus[] = ["BACKLOG", "TODO", "DOING", "DONE"];

/** One flattened FlashList row: either a group header or a task card. */
type TaskListRow =
  | { type: "header"; key: string; status: TaskStatus; count: number }
  | { type: "task"; key: string; task: Task; indexInGroup: number };

/** Web `groupTasksByStatus` returns only non-empty groups; same here. */
function buildRows(tasks: Task[]): TaskListRow[] {
  const rows: TaskListRow[] = [];
  for (const status of STATUS_ORDER) {
    const inGroup = tasks.filter((task) => task.status === status);
    if (inGroup.length === 0) continue;
    rows.push({ type: "header", key: `header-${status}`, status, count: inGroup.length });
    inGroup.forEach((task, indexInGroup) => {
      rows.push({ type: "task", key: task.id, task, indexInGroup });
    });
  }
  return rows;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const RESCHEDULE_OPTIONS: Array<{ label: string; daysFromToday: number; icon: IconName }> = [
  { label: "Today", daysFromToday: 0, icon: "today" },
  { label: "Tomorrow", daysFromToday: 1, icon: "schedule" },
  { label: "Next week", daysFromToday: 7, icon: "chevron" },
];

/** Due dates as "Mar 4" — web renders `formatDate(task.dueDate, 'MMM d')`. */
function formatDueDate(dueDate: string): string {
  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TasksScreen() {
  const analytics = useAnalytics();
  const listQueryKey = taskQueries.taskQueries.list();

  const { data: tasks, isPending, isError, error, isFetching, refetch } = useQuery(taskQueries.list());

  const rows = useMemo(() => buildRows(tasks ?? []), [tasks]);

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
    ({ item }: ListRenderItemInfo<TaskListRow>) => {
      if (item.type === "header") {
        return (
          <SectionHeader
            label={taskStatusLabel(item.status)}
            count={item.count}
            tone={taskStatusTone(item.status)}
            dimmed={item.status === "DONE"}
          />
        );
      }
      return (
        <TaskRow
          task={item.task}
          index={item.indexInGroup}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onReschedule={openReschedule}
          onEdit={openEdit}
        />
      );
    },
    [handleComplete, handleDelete, openEdit, openReschedule],
  );

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <View style={styles.skeletonWrap}>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <SkeletonListItem key={index} showLeading={false} />
        ))}
      </View>
    );
  } else if (isError && !tasks) {
    content = <ErrorState message={error instanceof Error ? error.message : "Couldn't load tasks."} onRetry={refetch} />;
  } else if (rows.length === 0) {
    content = (
      <ListEmptyState
        variant="tasks"
        title="No tasks yet"
        description="Add a task to link it to your schedule and goals — the hours you log against it roll up automatically."
        actionLabel="Add task"
        onAction={openQuickAdd}
        hint="Swipe a task right to complete it, left to reschedule or delete."
      />
    );
  } else {
    content = (
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.key}
        // Headers and cards are structurally different; separate recycling
        // pools stop FlashList reusing one as the other.
        getItemType={(row) => row.type}
        refreshing={isFetching && !isPending}
        onRefresh={refetch}
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    // edges={["top"]} — the layout renders `headerShown: false` for every
    // route, so this is what keeps the title out of the status bar.
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader eyebrow="Do" title="Tasks" subtitle="Everything on deck, grouped by where it stands." />

      <View style={styles.listArea}>{content}</View>

      <Pressable
        style={styles.fab}
        onPress={openQuickAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add task"
      >
        <Icon name="add" size={26} color={colors.primaryForeground} />
      </Pressable>

      <QuickAddSheet ref={quickAddSheetRef} kind="task" />
      <EditTaskSheet ref={editTaskRef} />

      <BottomSheetModal ref={rescheduleSheetRef} snapPoints={RESCHEDULE_SNAP_POINTS} enablePanDownToClose>
        <BottomSheetView style={styles.rescheduleContent}>
          <Text style={styles.rescheduleEyebrow}>Reschedule</Text>
          <Text style={styles.rescheduleTitle} numberOfLines={2}>
            {rescheduleTarget?.title ?? "task"}
          </Text>
          {RESCHEDULE_OPTIONS.map((option) => (
            <Pressable
              key={option.label}
              style={styles.rescheduleOption}
              onPress={() => pickRescheduleDate(option.daysFromToday)}
              accessibilityRole="button"
              accessibilityLabel={`Reschedule to ${option.label}`}
            >
              <Icon name={option.icon} size={18} color={colors.mutedForeground} />
              <Text style={styles.rescheduleOptionText}>{option.label}</Text>
            </Pressable>
          ))}
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const RESCHEDULE_SNAP_POINTS = ["40%"];

interface TaskRowProps {
  task: Task;
  index: number;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
  onReschedule: (task: Task) => void;
  onEdit: (task: Task) => void;
}

function TaskRow({ task, index, onComplete, onDelete, onReschedule, onEdit }: TaskRowProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const isDone = task.status === "DONE";
  const tone = taskStatusTone(task.status);

  const renderLeftActions = useCallback(() => {
    if (isDone) return null;
    return (
      <Pressable
        style={[styles.swipeAction, styles.completeAction]}
        onPress={() => {
          swipeableRef.current?.close();
          onComplete(task);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Complete "${task.title}"`}
      >
        <Icon name="check" size={18} color={colors.successForeground} />
        <Text style={styles.swipeActionText}>Complete</Text>
      </Pressable>
    );
  }, [isDone, onComplete, task]);

  const renderRightActions = useCallback(
    () => (
      <View style={styles.swipeActionsRow}>
        <Pressable
          style={[styles.swipeAction, styles.rescheduleAction]}
          onPress={() => {
            swipeableRef.current?.close();
            onReschedule(task);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Reschedule "${task.title}"`}
        >
          <Icon name="schedule" size={18} color={colors.white} />
          <Text style={styles.swipeActionText}>Reschedule</Text>
        </Pressable>
        <Pressable
          style={[styles.swipeAction, styles.deleteAction]}
          onPress={() => {
            swipeableRef.current?.close();
            onDelete(task);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete "${task.title}"`}
        >
          <Icon name="trash" size={18} color={colors.destructiveForeground} />
          <Text style={styles.swipeActionText}>Delete</Text>
        </Pressable>
      </View>
    ),
    [onDelete, onReschedule, task],
  );

  return (
    // marginBottom lives on the wrapper, not the card, so the Swipeable's own
    // height matches the card exactly and the revealed action colours don't
    // bleed into the gap between rows.
    <View style={styles.rowWrap}>
      <Swipeable ref={swipeableRef} renderLeftActions={renderLeftActions} renderRightActions={renderRightActions}>
        <ListCard
          accentColor={TONES[tone].accent}
          index={index}
          dimmed={isDone}
          onPress={() => onEdit(task)}
          accessibilityLabel={`Edit "${task.title}"`}
          contentStyle={styles.cardContent}
        >
          <View style={styles.rowTop}>
            <CompleteCheckbox
              checked={isDone}
              disabled={isDone}
              onPress={() => onComplete(task)}
              accessibilityLabel={`Complete "${task.title}"`}
            />

            {/* No status pill on the row itself: the group header above
                already names the status for every card under it, and the
                card's left stripe carries the same tone. Repeating it a third
                time per row was pure noise and stole width from the title. */}
            <Text style={[styles.rowTitle, isDone && styles.rowTitleDone]} numberOfLines={2}>
              {task.title}
            </Text>
          </View>

          <TaskMeta task={task} />
        </ListCard>
      </Swipeable>
    </View>
  );
}

/**
 * The chip row — a direct port of task-metadata.tsx's four chips. Renders
 * nothing at all when a task has no metadata, so bare tasks stay a single
 * compact line instead of reserving empty space.
 */
function TaskMeta({ task }: { task: Task }) {
  const hasMeta =
    !!task.category || !!task.goal || !!task.scheduleBlock || !!task.dueDate || !!task.estimatedMinutes;
  if (!hasMeta) return null;

  return (
    <View style={styles.chipRow}>
      {task.category ? <MetaChip label={task.category.replace("_", " ")} /> : null}
      {task.goal ? <MetaChip icon="goals" label={task.goal.title} accentColor={task.goal.color} /> : null}
      {task.scheduleBlock ? (
        <MetaChip
          icon="timer"
          label={`${formatTime12h(task.scheduleBlock.startTime)} – ${formatTime12h(task.scheduleBlock.endTime)}`}
        />
      ) : null}
      {task.dueDate ? <MetaChip icon="schedule" tone="warning" label={`Due ${formatDueDate(task.dueDate)}`} /> : null}
      {task.estimatedMinutes ? <MetaChip icon="timer" label={formatDuration(task.estimatedMinutes)} /> : null}
    </View>
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
    paddingBottom: spacing.xxxl * 3,
  },
  skeletonWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },

  // --- Row ---
  rowWrap: {
    marginBottom: spacing.md,
  },
  cardContent: {
    gap: spacing.md,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
    lineHeight: 19,
  },
  rowTitleDone: {
    textDecorationLine: "line-through",
    color: colors.mutedForeground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingLeft: CHECKBOX_RAIL,
  },

  // --- Swipe actions ---
  swipeActionsRow: {
    flexDirection: "row",
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radii.lg,
    marginHorizontal: spacing.xxs,
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
    ...typography.label,
    color: colors.white,
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

  // --- Reschedule sheet ---
  rescheduleContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  rescheduleEyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  rescheduleTitle: {
    ...typography.title,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  rescheduleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: minTouchTarget,
    borderRadius: radii.lg,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rescheduleOptionText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
});
