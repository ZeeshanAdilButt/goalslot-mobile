// Time Tracker tab: start/pause/resume/stop a timer against a task or goal,
// then log it as a TimeEntry, plus a feed of recently logged entries.
//
// The running-timer state itself lives in src/lib/timer-store.ts (a
// persisted zustand store) rather than here — this screen just renders that
// state and ticks a local re-render every second while running. See that
// file's header comment for why the ticking interval lives here and not
// inside the store.

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";

import {
  createTimeEntrySchema,
  formatDuration,
  getLocalDateString,
  type Goal,
  type Task,
  type TimeEntry,
} from "@goalslot/shared";

import { EmptyState, ErrorState, SkeletonListItem } from "@/components";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion, hapticLight } from "@/lib/haptics";
import { goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { getElapsedMs, useTimerStore } from "@/lib/timer-store";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const RECENT_SKELETON_ROWS = 4;

/**
 * mm:ss or h:mm:ss for the big live clock. Deliberately not
 * `formatDuration` from packages/shared/src/scheduling/time.ts — that
 * formats whole minutes for summaries ("1h 20m"), not a seconds-precision
 * ticking display, so it's the wrong tool for this specific job. Past
 * entries in the recent list below do use `formatDuration`.
 */
function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function TimerScreen() {
  const analytics = useAnalytics();

  const status = useTimerStore((s) => s.status);
  const startedAt = useTimerStore((s) => s.startedAt);
  const pausedElapsedMs = useTimerStore((s) => s.pausedElapsedMs);
  const timerTaskId = useTimerStore((s) => s.taskId);
  const timerGoalId = useTimerStore((s) => s.goalId);
  const start = useTimerStore((s) => s.start);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const stop = useTimerStore((s) => s.stop);

  const [pickerOpen, setPickerOpen] = useState(false);
  // What the *next* run will be tracked against, chosen before pressing
  // Start. Once running, the store's own taskId/goalId (set by `start`) is
  // the source of truth instead — this only matters pre-start.
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

  const tasksQuery = useQuery(taskQueries.list());
  const goalsQuery = useQuery(goalQueries.list());
  const recentQuery = useQuery(timeEntryQueries.recent());

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "timer" } });
    }, [analytics]),
  );

  // Forces a re-render every second while running, so the clock below
  // (computed fresh each render via `getElapsedMs`) actually appears to
  // tick. No elapsed value is stored here — see timer-store.ts.
  const [, forceTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, [status]);

  const elapsedMs = getElapsedMs({ status, startedAt, pausedElapsedMs });

  // What's actually being tracked right now — resolved from the store's
  // persisted ids against the loaded task/goal lists, so this is correct
  // even right after an app restart (before this screen ever set local
  // picker state). Falls back to the pre-start local selection while idle.
  const activeTask = useMemo(
    () => tasksQuery.data?.find((t) => t.id === timerTaskId) ?? (status === "idle" ? selectedTask : null),
    [tasksQuery.data, timerTaskId, status, selectedTask],
  );
  const activeGoal = useMemo(
    () => goalsQuery.data?.find((g) => g.id === timerGoalId) ?? (status === "idle" ? selectedGoal : null),
    [goalsQuery.data, timerGoalId, status, selectedGoal],
  );
  const activeLabel = activeTask?.title ?? activeGoal?.title ?? null;

  const handlePickTask = useCallback((task: Task) => {
    setSelectedTask(task);
    setSelectedGoal(null);
    setPickerOpen(false);
  }, []);

  const handlePickGoal = useCallback((goal: Goal) => {
    setSelectedGoal(goal);
    setSelectedTask(null);
    setPickerOpen(false);
  }, []);

  const handleStart = useCallback(() => {
    if (!selectedTask && !selectedGoal) return;
    start(selectedTask?.id, selectedTask?.goalId ?? selectedGoal?.id);
    hapticLight();
    analytics.track({ name: "timerStarted", payload: { taskId: selectedTask?.id } });
  }, [analytics, selectedGoal, selectedTask, start]);

  const handlePause = useCallback(() => {
    pause();
    hapticLight();
    analytics.track({ name: "timerPaused", payload: { taskId: timerTaskId ?? undefined } });
  }, [analytics, pause, timerTaskId]);

  const handleResume = useCallback(() => {
    resume();
    hapticLight();
  }, [resume]);

  const handleStop = useCallback(async () => {
    // Capture what was actually running before `stop()` resets the store
    // back to idle (which clears taskId/goalId).
    const stoppedTaskId = timerTaskId ?? undefined;
    const stoppedGoalId = activeTask?.goalId ?? timerGoalId ?? undefined;
    const label = activeLabel ?? "Untitled session";

    const elapsed = stop();
    const elapsedSeconds = Math.round(elapsed / 1000);
    // The API requires at least 1 minute (see validation/time-entry.ts) —
    // round to the nearest minute but never log a zero-minute entry for a
    // timer that genuinely ran.
    const durationMinutes = Math.max(1, Math.round(elapsed / 60000));

    try {
      const payload = createTimeEntrySchema.parse({
        taskName: label,
        taskId: stoppedTaskId,
        taskTitle: stoppedTaskId ? label : undefined,
        goalId: stoppedGoalId,
        duration: durationMinutes,
        date: getLocalDateString(),
      });
      await apiClient.timeEntries.create(payload);
      hapticCompletion();
      analytics.track({
        name: "timerStopped",
        payload: { taskId: stoppedTaskId, durationSeconds: elapsedSeconds },
      });
      setSelectedTask(null);
      setSelectedGoal(null);
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
    } catch {
      Alert.alert("Couldn't save time entry", "Your timer was stopped, but saving the entry failed. Please try again.");
    }
  }, [activeLabel, activeTask, stop, timerGoalId, timerTaskId]);

  const canStart = status === "idle" && (selectedTask !== null || selectedGoal !== null);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.header}>Time Tracker</Text>

      <View style={styles.timerCard}>
        <Text style={styles.trackingLabel}>{activeLabel ?? "Nothing selected"}</Text>
        <Text style={styles.clock}>{formatClock(elapsedMs)}</Text>

        {status === "idle" ? (
          <>
            <Pressable
              style={styles.pickerButton}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={activeLabel ? "Change task or goal" : "Choose task or goal"}
            >
              <Text style={styles.pickerButtonText}>
                {activeLabel ? "Change task or goal" : "Choose task or goal"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, !canStart && styles.buttonDisabled]}
              onPress={handleStart}
              disabled={!canStart}
              accessibilityRole="button"
              accessibilityLabel="Start timer"
              accessibilityState={{ disabled: !canStart }}
            >
              <Text style={styles.primaryButtonText}>Start</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.controlRow}>
            {status === "running" ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={handlePause}
                accessibilityRole="button"
                accessibilityLabel="Pause timer"
              >
                <Text style={styles.secondaryButtonText}>Pause</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.secondaryButton}
                onPress={handleResume}
                accessibilityRole="button"
                accessibilityLabel="Resume timer"
              >
                <Text style={styles.secondaryButtonText}>Resume</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.stopButton}
              onPress={() => void handleStop()}
              accessibilityRole="button"
              accessibilityLabel="Stop timer and log entry"
            >
              <Text style={styles.stopButtonText}>Stop</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Recent entries</Text>
      <View style={styles.listArea}>
        {recentQuery.isPending ? (
          <View>
            {Array.from({ length: RECENT_SKELETON_ROWS }).map((_, index) => (
              <SkeletonListItem key={index} showLeading={false} />
            ))}
          </View>
        ) : recentQuery.isError ? (
          <ErrorState message="Couldn't load recent entries." onRetry={() => void recentQuery.refetch()} />
        ) : !recentQuery.data || recentQuery.data.length === 0 ? (
          <EmptyState message="No time logged yet" />
        ) : (
          <FlashList
            data={recentQuery.data}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <RecentEntryRow entry={item} />}
            refreshing={recentQuery.isFetching}
            onRefresh={() => void recentQuery.refetch()}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      <PickerModal
        visible={pickerOpen}
        tasks={tasksQuery.data ?? []}
        goals={goalsQuery.data ?? []}
        onPickTask={handlePickTask}
        onPickGoal={handlePickGoal}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

interface RecentEntryRowProps {
  entry: TimeEntry;
}

function RecentEntryRow({ entry }: RecentEntryRowProps) {
  const when = new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.taskTitle || entry.taskName}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {when}
          {entry.goal?.title ? ` · ${entry.goal.title}` : ""}
        </Text>
      </View>
      <Text style={styles.rowDuration}>{formatDuration(entry.duration)}</Text>
    </View>
  );
}

interface PickerModalProps {
  visible: boolean;
  tasks: Task[];
  goals: Goal[];
  onPickTask: (task: Task) => void;
  onPickGoal: (goal: Goal) => void;
  onClose: () => void;
}

// Deliberately not a searchable combobox — a plain modal with two chip
// rows, one tap to pick. Good enough for the list sizes this app deals
// with; a real search box is a v2 concern if lists grow large.
function PickerModal({ visible, tasks, goals, onPickTask, onPickGoal, onClose }: PickerModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>What are you tracking?</Text>

          <Text style={styles.modalSectionLabel}>Tasks</Text>
          <View style={styles.chipWrap}>
            {tasks.length === 0 ? (
              <Text style={styles.modalEmpty}>No tasks yet</Text>
            ) : (
              tasks.map((task) => (
                <Pressable
                  key={task.id}
                  style={styles.chip}
                  onPress={() => onPickTask(task)}
                  accessibilityRole="button"
                  accessibilityLabel={`Track task "${task.title}"`}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {task.title}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          <Text style={styles.modalSectionLabel}>Goals</Text>
          <View style={styles.chipWrap}>
            {goals.length === 0 ? (
              <Text style={styles.modalEmpty}>No goals yet</Text>
            ) : (
              goals.map((goal) => (
                <Pressable
                  key={goal.id}
                  style={styles.chip}
                  onPress={() => onPickGoal(goal)}
                  accessibilityRole="button"
                  accessibilityLabel={`Track goal "${goal.title}"`}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {goal.title}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          <Pressable
            style={styles.modalCloseButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.modalCloseText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    ...typography.h1,
    color: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },
  timerCard: {
    margin: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.md,
    ...shadows.card,
  },
  trackingLabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  clock: {
    fontSize: 48,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: colors.foreground,
  },
  pickerButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerButtonText: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  primaryButton: {
    marginTop: spacing.xs,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxxl * 1.5,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primaryForeground,
    textAlign: "center",
  },
  controlRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.lg,
    backgroundColor: colors.foreground,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.white,
    textAlign: "center",
  },
  stopButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.lg,
    backgroundColor: colors.destructive,
  },
  stopButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.white,
    textAlign: "center",
  },
  sectionTitle: {
    ...typography.label,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  listArea: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    color: colors.foreground,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  rowDuration: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xl,
    maxHeight: "70%",
  },
  modalTitle: {
    ...typography.h2,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  modalSectionLabel: {
    ...typography.label,
    color: colors.mutedForeground,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  modalEmpty: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  modalCloseButton: {
    marginTop: spacing.lg,
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  modalCloseText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
});
