// Tasks screen. Two views over the same query, switched by the segmented
// control in the header — the same pair dw-time-web offers
// (src/features/tasks/components/tasks-view.tsx:100 and :151-176, a
// Board/List toggle over one `tasks` array):
//
//   LIST  — swipe-left-to-reveal-complete, swipe-right-to-reveal
//           reschedule/delete, tap-the-row-to-edit, grouped by status.
//   BOARD — the four status columns as a horizontal pager. See
//           src/components/tasks/TaskBoard.tsx.
//
// List is the default rather than web's Board: it's the view this screen has
// always opened on, it's the one that carries the swipe gestures, and a
// board's value is triage, which is the thing you go looking for.
//
// All mutations follow the same optimistic-patch -> live call ->
// invalidate-or-rollback shape as src/hooks/useQuickAdd.ts, just inlined here
// instead of factored into a shared hook. The row-tap edit flow
// (title/category/due date/estimated minutes) opens
// src/components/EditTaskSheet.tsx, which follows the same shape itself.
//
// List layout is ported from dw-time-web's task list:
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

import {
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
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  taskStatusLabel,
  taskStatusTone,
  TONES,
  type SegmentOption,
} from "@/components/lists";
import { BOARD_COLUMNS, TaskBoard, TaskBoardSkeleton, TaskMetaChips } from "@/components/tasks";
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

type TaskView = "list" | "board";

/**
 * Web's toggle is two uppercase text buttons in a bordered group
 * (tasks-view.tsx:151-176). `SegmentedControl` is this app's existing
 * equivalent (it's what the Goals screen filters with) and already carries
 * `accessibilityRole="tab"` + a selected state, so the switch is announced
 * as a switch rather than as two unrelated buttons.
 */
const VIEW_OPTIONS: SegmentOption<TaskView>[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
];

const VIEW_SUBTITLE: Record<TaskView, string> = {
  list: "Everything on deck, grouped by where it stands.",
  board: "Four columns, one swipe apart. Move a card to change its status.",
};

export default function TasksScreen() {
  const analytics = useAnalytics();
  const listQueryKey = taskQueries.taskQueries.list();

  const { data: tasks, isPending, isError, error, isFetching, refetch } = useQuery(taskQueries.list());

  const [view, setView] = useState<TaskView>("list");
  const rows = useMemo(() => buildRows(tasks ?? []), [tasks]);

  const quickAddSheetRef = useRef<BottomSheetModal>(null);
  const rescheduleSheetRef = useRef<BottomSheetModal>(null);
  const moveSheetRef = useRef<BottomSheetModal>(null);
  const editTaskRef = useRef<EditTaskSheetRef>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Task | null>(null);
  const [moveTarget, setMoveTarget] = useState<Task | null>(null);

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

  /**
   * The board's answer to web's drag-a-card-between-columns
   * (task-board.tsx:152-169). Three routes out, because the API models the
   * DONE boundary as an event rather than a field:
   *
   *   -> DONE   POST /tasks/:id/complete, i.e. exactly `handleComplete`.
   *             That endpoint is what writes the COMPLETION time entry and
   *             rolls the hours onto the goal.
   *   DONE ->   POST /tasks/:id/restore first. Restore is what DELETES that
   *             completion entry and recomputes the goal's loggedHours from
   *             the live sum (dw-time-api tasks.service.ts:223-273); a plain
   *             status PUT leaves the phantom entry behind and the goal
   *             permanently over-credited. Restore always lands the task in
   *             TODO, so any other target needs the follow-up write. The web
   *             board takes the plain-PUT shortcut (task-board.tsx:164) and
   *             has that bug; mobile doesn't copy it.
   *   otherwise PUT /tasks/:id with the new status.
   */
  const handleMoveToStatus = useCallback(
    async (task: Task, status: TaskStatus) => {
      if (task.status === status) return;

      if (status === "DONE") {
        await handleComplete(task);
        return;
      }

      const wasDone = task.status === "DONE";
      const previous = patchTask(task.id, {
        status,
        ...(wasDone ? { completedAt: undefined, actualMinutes: undefined } : {}),
      });

      try {
        if (wasDone) {
          await apiClient.tasks.restore(task.id);
          if (status !== "TODO") {
            await apiClient.tasks.update(task.id, { status });
          }
        } else {
          await apiClient.tasks.update(task.id, { status });
        }
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      } catch {
        restoreSnapshot(previous);
        Alert.alert("Couldn't move task", "Please try again.");
      }
    },
    [handleComplete, patchTask, restoreSnapshot],
  );

  const openReschedule = useCallback((task: Task) => {
    setRescheduleTarget(task);
    rescheduleSheetRef.current?.present();
  }, []);

  const openMove = useCallback((task: Task) => {
    setMoveTarget(task);
    moveSheetRef.current?.present();
  }, []);

  const pickMoveStatus = useCallback(
    (status: TaskStatus) => {
      const target = moveTarget;
      moveSheetRef.current?.dismiss();
      if (target) void handleMoveToStatus(target, status);
    },
    [handleMoveToStatus, moveTarget],
  );

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

  // `/tasks?taskId=…` is what a task notification tap and a shared task link
  // both resolve to (src/lib/deep-links.ts:36 — "the list screen can opt into
  // reading it later"). Nothing read it, so those links landed the user on an
  // undifferentiated list. There is no `/tasks/[id]` detail route in v1, so
  // the closest thing to "here is that task" is its editor.
  //
  // Guarded by a ref rather than by clearing the param: the sheet must open
  // once per link, not again on every re-render or on tab re-focus, and the
  // ref survives both without a navigation side effect.
  const { taskId: deepLinkTaskId } = useLocalSearchParams<{ taskId?: string }>();
  const handledDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!deepLinkTaskId || handledDeepLinkRef.current === deepLinkTaskId) return;
    const target = tasks?.find((task) => task.id === deepLinkTaskId);
    if (!target) return;
    handledDeepLinkRef.current = deepLinkTaskId;
    openEdit(target);
  }, [deepLinkTaskId, openEdit, tasks]);

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

  // `isPending`, never `isLoading`: with the persisted query cache, a warm
  // start already has tasks in hand and only `isPending` is false there —
  // gating on `isLoading` (or on `isFetching`) would flash a skeleton over
  // data that's already on screen.
  let content: React.ReactNode;
  if (isPending) {
    content =
      view === "board" ? (
        <TaskBoardSkeleton />
      ) : (
        <View
          style={styles.skeletonWrap}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading tasks"
        >
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
            <SkeletonListItem key={index} showLeading={false} />
          ))}
        </View>
      );
  } else if (isError && !tasks) {
    content = <ErrorState message={error instanceof Error ? error.message : "Couldn't load tasks."} onRetry={refetch} />;
  } else if ((tasks?.length ?? 0) === 0) {
    // Emptiness is a property of the DATA, not of the list view's grouped
    // rows: the board renders four columns from the same tasks, so testing
    // `rows.length` here would have been the wrong question for it.
    content = (
      <ListEmptyState
        variant="tasks"
        title="No tasks yet"
        description="Add a task to link it to your schedule and goals — the hours you log against it roll up automatically."
        actionLabel="Add task"
        onAction={openQuickAdd}
        hint={
          view === "board"
            ? "Board view sorts them into Backlog, To Do, Doing and Done."
            : "Swipe a task right to complete it, left to reschedule or delete."
        }
      />
    );
  } else if (view === "board") {
    content = (
      <TaskBoard
        tasks={tasks ?? []}
        onComplete={handleComplete}
        onEdit={openEdit}
        onMove={openMove}
        refreshing={isFetching && !isPending}
        onRefresh={refetch}
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
      <ScreenHeader
        eyebrow="Do"
        title="Tasks"
        subtitle={VIEW_SUBTITLE[view]}
        action={<SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />}
      />

      {/* A failed refetch on top of cached tasks used to be silent: the
          `isError && !tasks` branch above only fires on a cold failure, so
          offline users saw a stale list with no hint it was stale. This says
          so without throwing away the data they can still read. */}
      {isError && tasks ? (
        <Pressable
          style={styles.staleBanner}
          onPress={() => void refetch()}
          accessibilityRole="button"
          accessibilityLabel="Couldn't refresh tasks. Tap to try again."
        >
          <Icon name="alert" size={14} color={colors.warning} />
          <Text style={styles.staleBannerText} numberOfLines={1}>
            Showing saved tasks — couldn&apos;t refresh
          </Text>
          <Icon name="refresh" size={14} color={colors.mutedForeground} />
        </Pressable>
      ) : null}

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

      {/* `enableDynamicSizing` + a backdrop, matching QuickAddSheet /
          EditTaskSheet. The fixed "40%" snap point this used to carry left a
          three-option list floating in half a screen of blank sheet, and
          without `backdropComponent` there was no scrim and no
          tap-outside-to-close — the only way out was a pan-down. */}
      <BottomSheetModal
        ref={rescheduleSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onDismiss={() => setRescheduleTarget(null)}
      >
        <BottomSheetView style={styles.sheetContent}>
          <Text style={styles.sheetEyebrow}>Reschedule</Text>
          <Text style={styles.sheetTitle} numberOfLines={2}>
            {rescheduleTarget?.title ?? "task"}
          </Text>
          {RESCHEDULE_OPTIONS.map((option) => (
            <Pressable
              key={option.label}
              style={styles.sheetOption}
              onPress={() => pickRescheduleDate(option.daysFromToday)}
              accessibilityRole="button"
              accessibilityLabel={`Reschedule to ${option.label}`}
            >
              <Icon name={option.icon} size={18} color={colors.mutedForeground} />
              <Text style={styles.sheetOptionText}>{option.label}</Text>
            </Pressable>
          ))}
        </BottomSheetView>
      </BottomSheetModal>

      {/* Board's column picker — the touch stand-in for web's drag-and-drop
          (see `handleMoveToStatus`). Column titles and helper lines come from
          the same BOARD_COLUMNS the board draws, so the sheet names the
          destinations exactly as the columns do. */}
      <BottomSheetModal
        ref={moveSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onDismiss={() => setMoveTarget(null)}
      >
        <BottomSheetView style={styles.sheetContent}>
          <Text style={styles.sheetEyebrow}>Move to</Text>
          <Text style={styles.sheetTitle} numberOfLines={2}>
            {moveTarget?.title ?? "task"}
          </Text>
          {BOARD_COLUMNS.map((column) => {
            const isCurrent = moveTarget?.status === column.status;
            return (
              <Pressable
                key={column.status}
                style={[styles.sheetOption, isCurrent && styles.sheetOptionCurrent]}
                onPress={() => pickMoveStatus(column.status)}
                disabled={isCurrent}
                accessibilityRole="button"
                accessibilityState={{ disabled: isCurrent, selected: isCurrent }}
                accessibilityLabel={isCurrent ? `Already in ${column.title}` : `Move to ${column.title}`}
              >
                <View style={[styles.moveDot, { backgroundColor: TONES[column.tone].accent }]} />
                <View style={styles.moveTextBlock}>
                  <Text style={styles.sheetOptionText}>{column.title}</Text>
                  <Text style={styles.moveHelper} numberOfLines={1}>
                    {isCurrent ? "Where it is now" : column.helper}
                  </Text>
                </View>
                {isCurrent ? <Icon name="check" size={16} color={colors.mutedForeground} /> : null}
              </Pressable>
            );
          })}
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

function renderBackdrop(props: BottomSheetBackdropProps) {
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />;
}

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

          {/* Chips moved to src/components/tasks/TaskMetaChips.tsx when the
              board landed — the board card renders the same set, `compact`. */}
          <TaskMetaChips task={task} style={styles.chipRow} />
        </ListCard>
      </Swipeable>
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
    paddingLeft: CHECKBOX_RAIL,
  },

  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
    borderRadius: radii.lg,
    backgroundColor: colors.warningMuted,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  staleBannerText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
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

  // --- Reschedule / Move sheets (same shape, so one set of styles) ---
  sheetContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  sheetEyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  sheetTitle: {
    ...typography.title,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  sheetOption: {
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
  sheetOptionCurrent: {
    // Stays visible and readable rather than dropping to 40% opacity: it's
    // the row that answers "where is this now?", it just isn't tappable.
    backgroundColor: colors.background,
    borderStyle: "dashed",
  },
  sheetOptionText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  moveDot: {
    width: 10,
    height: 10,
    borderRadius: radii.full,
  },
  moveTextBlock: {
    flex: 1,
    gap: 1,
  },
  moveHelper: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
});
