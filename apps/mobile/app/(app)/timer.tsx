// Time Tracker tab: start/pause/resume/stop a timer against a task or goal,
// then log it as a TimeEntry, plus a feed of recently logged sessions.
//
// The running-timer state itself lives in src/lib/timer-store.ts (a
// persisted zustand store) rather than here — this screen just renders that
// state. Note that the once-a-second tick that animates the clock now lives
// inside <TimerRing/> instead of this component: it used to re-render the
// whole screen (picker, controls, session list) every second purely to move
// the digits. See that file's header for the full reasoning.
//
// Product language and semantics follow dw-time-web's time-tracker feature
// (dw-time-web/src/features/time-tracker/components/timer-display.tsx,
// timer-controls.tsx, recent-entries.tsx) — the dark status pill with a
// pulsing accent dot, the tabular hh:mm:ss clock with dimmed seconds, and
// the "Tracking / Paused / Ready to start" vocabulary are all carried over.
// The presentation is native rather than a port of the web layout: a
// circular progress hero, round transport controls, and a day-grouped
// session list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  createTimeEntrySchema,
  formatDuration,
  getLocalDateString,
  type Goal,
  type Task,
} from "@goalslot/shared";

import { EmptyState, ErrorState, SkeletonListItem } from "@/components";
import { SessionHistory } from "@/components/timer/SessionHistory";
import { TimerControls } from "@/components/timer/TimerControls";
import { TimerRing } from "@/components/timer/TimerRing";
import { TrackingPicker } from "@/components/timer/TrackingPicker";
import { TrackingTarget } from "@/components/timer/TrackingTarget";
import { useTimerNotification } from "@/components/timer/useTimerNotification";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion, hapticLight } from "@/lib/haptics";
import { goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useTimerStore, type TimerStatus } from "@/lib/timer-store";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const RECENT_SKELETON_ROWS = 4;

/**
 * The floating hamburger (app/(app)/_layout.tsx) is absolutely positioned at
 * top-right over every screen. Same 64pt gutter app/(app)/index.tsx and
 * schedule.tsx reserve — without it "Time Tracker" runs under the button at
 * large text sizes.
 */
const HAMBURGER_CLEARANCE = 64;

/**
 * Shown in place of the real title while a session is running but its
 * task/goal hasn't resolved yet — see `activeLabel` below. Matches the
 * fallback wording useTimerNotification.ts uses for the same situation.
 */
const UNRESOLVED_TARGET_LABEL = "Focus session";

/** Ring diameter ceiling on a large phone — past this the hero stops feeling like part of a screen. */
const MAX_RING_SIZE = 300;
/**
 * Share of the viewport height the ring may take. This is what stops the
 * hero card from pushing the session list off a short device: on a 844pt
 * phone it resolves to ~287pt (a ~53pt clock), on a 568pt one to ~193pt.
 */
const RING_HEIGHT_FRACTION = 0.34;
/** Screen padding (spacing.xl) + card padding (spacing.xl), both sides. */
const RING_HORIZONTAL_INSET = 4 * spacing.xl;

const STATUS_META: Record<TimerStatus, { label: string; dotColor: string; pulse: boolean; textColor: string }> = {
  idle: { label: "Ready to start", dotColor: colors.mutedForeground, pulse: false, textColor: colors.white },
  running: { label: "Tracking", dotColor: colors.primary, pulse: true, textColor: colors.primary },
  paused: { label: "Paused", dotColor: colors.primary, pulse: false, textColor: colors.primary },
};

export default function TimerScreen() {
  const analytics = useAnalytics();
  const { width, height } = useWindowDimensions();

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
  const resolvedLabel = activeTask?.title ?? activeGoal?.title ?? null;

  // The store persists only ids, so a running session's title has to be
  // looked up in the task/goal lists — and those lists can be momentarily
  // absent (cold start before the first fetch lands, or a cache eviction
  // mid-session). Latching the last title we successfully resolved for THIS
  // pair of ids stops the hero row, the shade notification and — the part
  // that actually mattered — the entry we eventually POST from degrading to
  // "Untitled session" just because a list request happens to be in flight.
  // The key guard is what makes it safe: a latch from a previous target can
  // never be shown against a new one.
  const targetKey = `${timerTaskId ?? ""}|${timerGoalId ?? ""}`;
  const labelLatch = useRef<{ key: string; label: string } | null>(null);
  if (resolvedLabel !== null) labelLatch.current = { key: targetKey, label: resolvedLabel };
  const latchedLabel = labelLatch.current?.key === targetKey ? labelLatch.current.label : null;

  // Null here means "we genuinely do not know what this is": only possible on
  // a cold start where nothing has ever resolved. A running timer still needs
  // *something* on screen, but it must not be a fabricated title that then
  // gets written to the API — hence the split below.
  const knownLabel = resolvedLabel ?? latchedLabel;
  const activeLabel = knownLabel ?? (status === "idle" ? null : UNRESOLVED_TARGET_LABEL);
  const activeColor = activeGoal?.color ?? activeTask?.goal?.color ?? null;
  // A task shows its parent goal; a goal shows its category — either way the
  // second line answers "which bucket does this belong to?".
  const activeSublabel = activeTask ? (activeTask.goal?.title ?? null) : (activeGoal?.category ?? null);

  // Puts a persistent entry in the notification shade for the life of the
  // session, so a running timer is visible from outside the app. Degrades to
  // nothing at all if notification permission is refused.
  useTimerNotification({ status, startedAt, pausedElapsedMs, label: activeLabel });

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

  // `stop()` resets the store synchronously, so a second press can only land
  // inside the same frame as the first — but two fingers do exactly that, and
  // the second call would return `getElapsedMs(INITIAL_STATE)` === 0, which
  // `Math.max(1, ...)` below dutifully turns into a spurious 1-minute entry.
  // A ref (not state) because it has to be readable before the re-render.
  const stopping = useRef(false);

  const handleStop = useCallback(async () => {
    if (stopping.current || status === "idle") return;
    stopping.current = true;

    // Capture what was actually running before `stop()` resets the store
    // back to idle (which clears taskId/goalId/startedAt).
    const stoppedTaskId = timerTaskId ?? undefined;
    const stoppedGoalId = activeTask?.goalId ?? timerGoalId ?? undefined;
    const stoppedStartedAt = startedAt;
    // Only a title we actually resolved is fit to persist. When it's null the
    // display falls back to "Focus session" (see `activeLabel`), but writing
    // that placeholder into `taskTitle` would overwrite a real task's
    // denormalised title with a made-up one.
    const stoppedTitle = knownLabel;
    const label = stoppedTitle ?? UNRESOLVED_TARGET_LABEL;

    const elapsed = stop();
    const elapsedSeconds = Math.round(elapsed / 1000);
    // The API requires at least 1 minute (see validation/time-entry.ts) —
    // round to the nearest minute but never log a zero-minute entry for a
    // timer that genuinely ran.
    const durationMinutes = Math.max(1, Math.round(elapsed / 60000));

    const submit = async () => {
      const payload = createTimeEntrySchema.parse({
        taskName: label,
        taskId: stoppedTaskId,
        taskTitle: stoppedTaskId && stoppedTitle ? stoppedTitle : undefined,
        goalId: stoppedGoalId,
        duration: durationMinutes,
        date: getLocalDateString(),
        // Mirrors dw-time-web's time-tracker-page.tsx:293, which sends the
        // wall-clock start alongside the duration. Mobile was dropping this
        // optional field entirely (it has been in createTimeEntrySchema all
        // along), so every phone-tracked entry reached the API with no idea
        // *when* in the day it happened, while web-tracked ones carried it.
        // Semantics match web exactly, down to the rough edges: this is the
        // current running segment's start, which both platforms' `resume`
        // resets to now and both platforms' `pause` sets to null — so a
        // session stopped from Paused sends nothing, same as on web.
        startedAt: stoppedStartedAt !== null ? new Date(stoppedStartedAt).toISOString() : undefined,
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
    };

    try {
      await submit();
    } catch {
      // The store is already back to idle at this point, so the elapsed time
      // exists nowhere but this closure — a bare "please try again" would
      // discard the session outright. Offer the retry here, and name the
      // duration either way so it can be re-entered by hand if the retry
      // fails too.
      Alert.alert(
        "Couldn't save time entry",
        `Your timer was stopped, but saving ${formatDuration(durationMinutes)} against "${label}" failed.`,
        [
          { text: "Discard", style: "destructive" },
          {
            text: "Retry",
            onPress: () => {
              void submit().catch(() => {
                Alert.alert(
                  "Still couldn't save",
                  `Add ${formatDuration(durationMinutes)} for "${label}" manually when you're back online.`,
                );
              });
            },
          },
        ],
      );
    } finally {
      stopping.current = false;
    }
  }, [activeTask, analytics, knownLabel, startedAt, status, stop, timerGoalId, timerTaskId]);

  const canStart = status === "idle" && (selectedTask !== null || selectedGoal !== null);
  const statusMeta = STATUS_META[status];
  const ringSize = Math.max(
    150,
    Math.min(MAX_RING_SIZE, width - RING_HORIZONTAL_INSET, height * RING_HEIGHT_FRACTION),
  );

  // Fixed wall-clock start beats a second copy of the elapsed count already
  // filling the middle of the ring.
  const ringCaption =
    status === "running" && startedAt !== null
      ? `Started ${new Date(startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : status === "paused"
        ? "Paused"
        : "Elapsed";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Focus</Text>
        <Text style={styles.headerTitle}>Time Tracker</Text>
      </View>

      <View style={styles.timerCard}>
        <View style={styles.statusPill}>
          <PulsingDot color={statusMeta.dotColor} pulse={statusMeta.pulse} />
          <Text style={[styles.statusPillText, status !== "idle" && { color: statusMeta.textColor }]}>
            {statusMeta.label}
          </Text>
        </View>

        <TimerRing
          status={status}
          startedAt={startedAt}
          pausedElapsedMs={pausedElapsedMs}
          size={ringSize}
          accentColor={activeColor}
          caption={ringCaption}
        />

        <TrackingTarget
          label={activeLabel}
          sublabel={activeSublabel}
          accentColor={activeColor}
          editable={status === "idle"}
          onPress={() => setPickerOpen(true)}
        />

        <TimerControls
          status={status}
          canStart={canStart}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={() => void handleStop()}
        />
      </View>

      <View style={styles.listArea}>
        {recentQuery.isPending ? (
          <View style={styles.skeletonArea}>
            {Array.from({ length: RECENT_SKELETON_ROWS }).map((_, index) => (
              <SkeletonListItem key={index} showLeading={false} />
            ))}
          </View>
        ) : recentQuery.isError ? (
          <ErrorState message="Couldn't load recent entries." onRetry={() => void recentQuery.refetch()} />
        ) : !recentQuery.data || recentQuery.data.length === 0 ? (
          <EmptyState
            message="No sessions yet"
            description="Pick a task or goal above and press start — logged sessions land here."
          />
        ) : (
          <SessionHistory
            entries={recentQuery.data}
            refreshing={recentQuery.isFetching && !recentQuery.isPending}
            onRefresh={() => void recentQuery.refetch()}
          />
        )}
      </View>

      <TrackingPicker
        visible={pickerOpen}
        tasks={tasksQuery.data ?? []}
        goals={goalsQuery.data ?? []}
        selectedId={selectedTask?.id ?? selectedGoal?.id ?? null}
        onPickTask={handlePickTask}
        onPickGoal={handlePickGoal}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

// Small animated status dot — mirrors dw-time-web's TimerDisplay pill, whose
// "RUNNING" dot pulses (`animate-pulse`) while STOPPED/PAUSED stay static.
// Uses Reanimated (already a dependency; see Skeleton.tsx for the same
// pattern) rather than the JS-thread Animated API.
//
// This is the one animation on the screen that never stops on its own, which
// makes honouring Reduce Motion non-optional: an indefinitely repeating
// opacity loop is exactly the "continuous, non-essential motion" the setting
// exists to switch off, and it would otherwise pulse for the entire length of
// a session. TimerRing, Reveal and the Reports charts already gate on
// `useReduceMotion`; this was the gap.
function PulsingDot({ color, pulse }: { color: string; pulse: boolean }) {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!pulse || reduceMotion) {
      cancelAnimation(opacity);
      // Full opacity, not the dimmed mid-pulse value: with motion off the dot
      // is a plain "tracking" indicator and still has to read as lit.
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(withTiming(0.3, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [pulse, reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.statusDot, { backgroundColor: color }, animatedStyle]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xl,
    // Reserves the floating menu button's column, and matches the spacing.md
    // top inset every other tab header uses (this was spacing.xs, which put
    // the title a few points higher than the hamburger it sits beside).
    paddingRight: HAMBURGER_CLEARANCE,
    paddingTop: spacing.md,
    gap: 2,
  },
  eyebrow: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.foreground,
  },
  timerCard: {
    margin: spacing.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.lg,
    ...shadows.card,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.foreground,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    color: colors.white,
  },
  listArea: {
    flex: 1,
  },
  skeletonArea: {
    paddingHorizontal: spacing.xl,
  },
});
