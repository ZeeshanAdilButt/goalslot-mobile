// Tasks screen. Two views over the same query, switched by the segmented
// control in the header — the same pair dw-time-web offers
// (src/features/tasks/components/tasks-view.tsx:100 and :151-176, a
// Board/List toggle over one `tasks` array):
//
//   LIST  — swipe-left-to-reveal-complete (Restore on a DONE row),
//           swipe-right-to-reveal reschedule/delete, tap-the-row-to-edit,
//           grouped by status.
//   BOARD — the four status columns as a horizontal pager. See
//           src/components/tasks/TaskBoard.tsx.
//
// COMPLETION IS A TWO-WAY TOGGLE on both views. It used not to be: the
// checkbox was `disabled` once a task was DONE, the complete-swipe rendered
// nothing, and EditTaskSheet has no status field — so the only route back from
// DONE was switching to Board and using the Move sheet. Both directions are
// real API operations (POST /complete, POST /restore), and a control whose
// `accessibilityRole` is "checkbox" promises a two-way toggle, so both the
// checkbox and the left-swipe now flip whichever way the task's status calls
// for. See `handleToggleComplete` and components/tasks/task-actions.ts.
//
// DELETE IS CONFIRMED, from either view, through one screen-level themed
// `ConfirmDialog` (never `Alert.alert` — see ConfirmDialog.tsx's own header).
// `DELETE /tasks/:id` is a HARD delete and `POST /restore` only un-completes,
// so a swipe plus a tap used to destroy a task outright with nothing to undo
// it. The dialog lives here rather than in the row/card so the list swipe and
// the board card's Delete button are literally the same flow.
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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

import {
  genId,
  getLocalDateString,
  type CompleteTaskInput,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
} from "@goalslot/shared";

import { EditTaskSheet, type EditTaskSheetRef } from "@/components/EditTaskSheet";
import { ErrorState } from "@/components/ErrorState";
import { QuickAddSheet } from "@/components/QuickAddSheet";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
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
import {
  BOARD_COLUMNS,
  describeTaskDelete,
  taskCompletionAction,
  TaskBoard,
  TaskBoardSkeleton,
  TaskGoalFilter,
  TaskMetaChips,
  type GoalFilterOption,
} from "@/components/tasks";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { hapticCompletion } from "@/lib/haptics";
import { offlineSync, outbox, queueOfflineEdit } from "@/lib/offline";
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

/**
 * Goal filter — this screen's answer to "show me tasks under this goal"
 * (every task already carries its goal as a chip via TaskMetaChips, but
 * there was previously no way to go the other direction and start FROM a
 * goal). See TaskGoalFilter's header comment for why this is a filter
 * alongside the existing status grouping rather than a second nested
 * grouping.
 */
const GOAL_FILTER_ALL = "all";
/** The goal-less bucket — tasks without a goal stay visible under this key, never hidden. */
const GOAL_FILTER_NO_GOAL = "none";

/**
 * One option per distinct goal actually present on the (unfiltered) task
 * list, plus "All" and — only when at least one task has no goal — "No
 * goal". Sourced from `task.goal` (not `task.goalId`) to match
 * TaskMetaChips' own goal chip, so the filter's buckets and the per-task
 * chips always agree on what counts as "has a goal".
 */
function buildGoalFilterOptions(tasks: Task[]): GoalFilterOption[] {
  const goalBuckets = new Map<string, { label: string; color: string; count: number }>();
  let noGoalCount = 0;

  for (const task of tasks) {
    if (task.goal) {
      const bucket = goalBuckets.get(task.goal.id);
      if (bucket) {
        bucket.count += 1;
      } else {
        goalBuckets.set(task.goal.id, { label: task.goal.title, color: task.goal.color, count: 1 });
      }
    } else {
      noGoalCount += 1;
    }
  }

  const goalOptions = Array.from(goalBuckets.entries())
    .map(([id, bucket]) => ({ key: id, label: bucket.label, count: bucket.count, color: bucket.color }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Fewer than two buckets means there's nothing to filter BY — a single
  // goal (or none at all) already describes every task on screen, so a
  // filter row would just repeat what's already visible.
  const bucketCount = goalOptions.length + (noGoalCount > 0 ? 1 : 0);
  if (bucketCount < 2) return [];

  const options: GoalFilterOption[] = [{ key: GOAL_FILTER_ALL, label: "All", count: tasks.length }, ...goalOptions];
  if (noGoalCount > 0) {
    options.push({ key: GOAL_FILTER_NO_GOAL, label: "No goal", count: noGoalCount });
  }
  return options;
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

  // Options are built off the FULL task list (never the already-filtered
  // one) so picking "Olostep" doesn't make every other goal's chip vanish
  // from the row along with its tasks.
  const goalFilterOptions = useMemo(() => buildGoalFilterOptions(tasks ?? []), [tasks]);
  const [goalFilter, setGoalFilter] = useState<string>(GOAL_FILTER_ALL);
  // Falls back to "All" rather than trusting stale state verbatim: a goal
  // filter can go stale mid-session (its last task got reassigned or
  // deleted elsewhere), and rendering an empty row for a key that no longer
  // exists would look like a bug rather than an empty result.
  const activeGoalFilter = goalFilterOptions.some((option) => option.key === goalFilter) ? goalFilter : GOAL_FILTER_ALL;

  const filteredTasks = useMemo(() => {
    const all = tasks ?? [];
    if (activeGoalFilter === GOAL_FILTER_ALL) return all;
    if (activeGoalFilter === GOAL_FILTER_NO_GOAL) return all.filter((task) => !task.goal);
    return all.filter((task) => task.goal?.id === activeGoalFilter);
  }, [tasks, activeGoalFilter]);

  const rows = useMemo(() => buildRows(filteredTasks), [filteredTasks]);

  const quickAddSheetRef = useRef<BottomSheetModal>(null);
  const rescheduleSheetRef = useRef<BottomSheetModal>(null);
  const moveSheetRef = useRef<BottomSheetModal>(null);
  const editTaskRef = useRef<EditTaskSheetRef>(null);
  // See the hook's own header for why this is needed at all — the library
  // doesn't wire Android's hardware back button to a BottomSheetModal on its
  // own; every sheet in the app has to opt in individually.
  const { handleSheetPositionChange: handleReschedulePositionChange } =
    useBottomSheetBackHandler(rescheduleSheetRef);
  const { handleSheetPositionChange: handleMovePositionChange } = useBottomSheetBackHandler(moveSheetRef);
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
      } catch (err) {
        const queued = await queueOfflineEdit("task-complete", { id: task.id, data: payload }, err);
        if (queued) {
          // The patch above already applied (status: DONE); just tag it so
          // the row reads as "queued" rather than looking identically saved.
          patchTask(task.id, { pendingSync: true });
          notify("Queued — will sync when online", "offline");
        } else {
          restoreSnapshot(previous);
          console.error(err);
          notify(getErrorMessage(err, "Couldn't complete that task. Please try again."), "error");
        }
      }
    },
    [analytics, patchTask, restoreSnapshot],
  );

  // The task the delete confirmation is asking about. Held as the whole task,
  // not an id: `confirmDelete` removes the row from the cache optimistically
  // while the dialog is still on screen (busy, and possibly about to show an
  // error), so an id would leave the dialog with nothing to render its copy
  // from. Same construction as components/timer/SessionHistory.tsx.
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Both the list swipe and the board card's Delete button land here. */
  const requestDelete = useCallback((task: Task) => {
    setDeleteError(null);
    setPendingDelete(task);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleteBusy]);

  /**
   * Snapshot -> optimistic removal -> live DELETE -> invalidate on success,
   * the same shape as every other mutation on this screen. The one difference
   * from what this used to be (an unconfirmed `handleDelete` wired straight to
   * the swipe button) is where a genuine server rejection reports: inline,
   * inside the dialog that is already open, with the primary button back at
   * idle so the user can just try again — rather than an `Alert.alert` landing
   * on a row that has already vanished.
   */
  const confirmDelete = useCallback(async () => {
    const task = pendingDelete;
    if (!task || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError(null);

    const previous = removeTask(task.id);

    try {
      await apiClient.tasks.delete(task.id);
      void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      analytics.track({ name: "taskDeleted", payload: { taskId: task.id } });
      setPendingDelete(null);
    } catch (err) {
      const queued = await queueOfflineEdit("task-delete", { id: task.id }, err);
      if (queued) {
        // Reappears rather than staying gone — a delete that hasn't
        // happened yet shouldn't look like it already did — tagged
        // pending so it's clear the removal is only queued.
        queryClient.setQueryData<Task[]>(
          listQueryKey,
          (previous ?? []).map((t) => (t.id === task.id ? { ...t, pendingSync: true } : t)),
        );
        notify("Queued — will sync when online", "offline");
        setPendingDelete(null);
      } else {
        restoreSnapshot(previous);
        setDeleteError("Couldn't delete that task. Please try again.");
      }
    } finally {
      setDeleteBusy(false);
    }
  }, [analytics, deleteBusy, listQueryKey, pendingDelete, removeTask, restoreSnapshot]);

  const handleReschedule = useCallback(
    async (task: Task, dueDate: string) => {
      const payload: UpdateTaskInput = { dueDate };
      const previous = patchTask(task.id, { dueDate });

      try {
        await apiClient.tasks.update(task.id, payload);
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      } catch (err) {
        const queued = await queueOfflineEdit("task-update", { id: task.id, data: payload }, err);
        if (queued) {
          patchTask(task.id, { pendingSync: true });
          notify("Queued — will sync when online", "offline");
        } else {
          restoreSnapshot(previous);
          console.error(err);
          notify(getErrorMessage(err, "Couldn't reschedule that task. Please try again."), "error");
        }
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

      // Tracks whether the live `restore` call actually landed before a
      // later step failed, so the catch below only re-queues the step(s)
      // that didn't happen — queuing `task-restore` again after a restore
      // that already succeeded server-side would restore a second time.
      let restoreSucceeded = false;

      try {
        if (wasDone) {
          await apiClient.tasks.restore(task.id);
          restoreSucceeded = true;
          if (status !== "TODO") {
            await apiClient.tasks.update(task.id, { status });
          }
        } else {
          await apiClient.tasks.update(task.id, { status });
        }
        void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      } catch (err) {
        if (wasDone && !restoreSucceeded) {
          const queuedRestore = await queueOfflineEdit("task-restore", { id: task.id }, err);
          if (queuedRestore) {
            if (status !== "TODO") {
              // Sequenced after the restore above in the same outbox — the
              // drain replays entries in insertion order, so this only ever
              // runs once the restore it depends on has actually landed.
              await outbox.addToOutbox({
                id: genId(),
                kind: "task-update",
                payload: { id: task.id, data: { status } },
                idempotencyKey: genId(),
                createdAt: Date.now(),
                retries: 0,
              });
              void offlineSync.refreshPendingCount();
            }
            patchTask(task.id, { pendingSync: true });
            notify("Queued — will sync when online", "offline");
          } else {
            restoreSnapshot(previous);
            console.error(err);
            notify(getErrorMessage(err, "Couldn't move that task. Please try again."), "error");
          }
        } else {
          // Either the plain (!wasDone) path, or restore already succeeded
          // live and only the follow-up status update failed — either way
          // there's exactly one queued step left.
          const queued = await queueOfflineEdit("task-update", { id: task.id, data: { status } }, err);
          if (queued) {
            patchTask(task.id, { pendingSync: true });
            notify("Queued — will sync when online", "offline");
          } else {
            restoreSnapshot(previous);
            console.error(err);
            notify(getErrorMessage(err, "Couldn't move that task. Please try again."), "error");
          }
        }
      }
    },
    [handleComplete, patchTask, restoreSnapshot],
  );

  /**
   * The checkbox and the left-swipe, in whichever direction the task's status
   * calls for (components/tasks/task-actions.ts decides the copy for the same
   * split).
   *
   * Un-completing routes through `handleMoveToStatus(task, "TODO")` rather
   * than calling `apiClient.tasks.restore` directly, so the list view inherits
   * that function's whole DONE-boundary contract for free — the optimistic
   * clearing of `completedAt`/`actualMinutes`, the offline `task-restore`
   * queueing, the rollback — instead of a second, subtly different copy of it
   * living here. TODO is not a choice this makes: `POST /restore` always lands
   * the task there.
   */
  const handleToggleComplete = useCallback(
    (task: Task) => {
      if (task.status === "DONE") {
        void handleMoveToStatus(task, "TODO");
        return;
      }
      void handleComplete(task);
    },
    [handleComplete, handleMoveToStatus],
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
          onToggleComplete={handleToggleComplete}
          onDelete={requestDelete}
          onReschedule={openReschedule}
          onEdit={openEdit}
        />
      );
    },
    [handleToggleComplete, openEdit, openReschedule, requestDelete],
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
    content = <ErrorState message={getErrorMessage(error, "Couldn't load tasks.")} onRetry={refetch} />;
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
  } else if (filteredTasks.length === 0) {
    // Distinct from the true-empty branch above: there ARE tasks, the goal
    // filter just narrowed them to nothing. Offering "Add task" here would
    // be wrong too — the gap isn't that nothing exists, it's that this one
    // goal has nothing — so the recovery action clears the filter instead.
    const filterLabel = goalFilterOptions.find((option) => option.key === activeGoalFilter)?.label ?? "this goal";
    content = (
      <ListEmptyState
        variant="tasks"
        title="No tasks here"
        description={`Nothing under "${filterLabel}" right now. Try another goal, or clear the filter to see everything.`}
        actionLabel="Show all tasks"
        actionIcon="close"
        onAction={() => setGoalFilter(GOAL_FILTER_ALL)}
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
        tasks={filteredTasks}
        onToggleComplete={handleToggleComplete}
        onEdit={openEdit}
        onMove={openMove}
        onDelete={requestDelete}
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

  const deleteCopy = pendingDelete ? describeTaskDelete(pendingDelete) : null;

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

      {/* Hidden below two buckets (see buildGoalFilterOptions): with only one
          goal in play — or none at all — every task on screen already IS
          that bucket, so the row would just repeat the header above it. */}
      {goalFilterOptions.length > 0 ? (
        <TaskGoalFilter
          options={goalFilterOptions}
          value={activeGoalFilter}
          onChange={setGoalFilter}
          style={styles.goalFilter}
        />
      ) : null}

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
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
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
        onChange={handleReschedulePositionChange}
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
        onChange={handleMovePositionChange}
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

      {/* One dialog for both views — the list's Delete swipe and the board
          card's Delete button both call `requestDelete`, so the two paths
          can't drift apart. Rendered outside the two BottomSheetModals
          because it is a Modal of its own and has no relationship to either
          sheet's lifecycle. */}
      <ConfirmDialog
        visible={pendingDelete !== null}
        title={deleteCopy?.title ?? "Delete this task?"}
        description={deleteCopy?.description}
        icon="trash"
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </SafeAreaView>
  );
}

function renderBackdrop(props: BottomSheetBackdropProps) {
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />;
}

interface TaskRowProps {
  task: Task;
  index: number;
  /** Completes a live task, or sends a DONE one back to To Do — see `taskCompletionAction`. */
  onToggleComplete: (task: Task) => void;
  /** Opens the confirmation; the screen owns the dialog and the mutation. */
  onDelete: (task: Task) => void;
  onReschedule: (task: Task) => void;
  onEdit: (task: Task) => void;
}

// Memoised: renderItem above already hands this stable (useCallback)
// handlers, so without this every card re-rendered on every list-view
// re-render (a status change elsewhere in the list, a background refetch)
// rather than only when its own task/index changed.
const TaskRow = memo(function TaskRow({ task, index, onToggleComplete, onDelete, onReschedule, onEdit }: TaskRowProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const isDone = task.status === "DONE";
  const tone = taskStatusTone(task.status);
  const completion = taskCompletionAction(task);

  // A DONE row used to render NOTHING here, which left the gesture dead: the
  // row still swiped open and then sat there with a blank panel. It now
  // reveals Restore instead, so the left swipe means one consistent thing —
  // "flip this task's done-ness" — in both directions, and matches what the
  // checkbox on the same row does.
  const renderLeftActions = useCallback(
    () => (
      <Pressable
        style={[styles.swipeAction, isDone ? styles.restoreAction : styles.completeAction]}
        onPress={() => {
          swipeableRef.current?.close();
          onToggleComplete(task);
        }}
        accessibilityRole="button"
        accessibilityLabel={completion.accessibilityLabel}
        accessibilityHint={completion.accessibilityHint}
      >
        <Icon name={completion.icon} size={18} color={colors.white} />
        <Text style={styles.swipeActionText}>{completion.label}</Text>
      </Pressable>
    ),
    [completion, isDone, onToggleComplete, task],
  );

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
            {/* No `disabled={isDone}` any more: the box is a checkbox, and a
                checkbox that can only ever be ticked has no way back and
                mis-announces itself to a screen reader. Unticking it restores
                the task to To Do. */}
            <CompleteCheckbox
              checked={isDone}
              onPress={() => onToggleComplete(task)}
              accessibilityLabel={completion.accessibilityLabel}
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
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listArea: {
    flex: 1,
  },
  goalFilter: {
    flexGrow: 0,
    marginBottom: spacing.sm,
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
  // Restore is the same swipe as Complete, going the other way, so it takes
  // the same panel — just not the green one, which on a row that is already
  // ticked would read as "complete it again". Neutral zinc says "put this
  // back" without the alarm of the destructive red sitting on the opposite
  // swipe.
  restoreAction: {
    backgroundColor: colors.mutedForeground,
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
  // Every other pressable on this screen (rows, swipe actions) gives some
  // kind of feedback under a finger; the FAB — the screen's most-used
  // control — had none. A flat opacity dip is enough to read as "pressed"
  // without pulling in Reanimated for a one-off static state.
  fabPressed: {
    opacity: 0.85,
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
