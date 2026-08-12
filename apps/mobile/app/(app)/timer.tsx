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
  genId,
  getLocalDateString,
  updateTimeEntrySchema,
  type CreateTimeEntryInput,
  type Goal,
  type Task,
  type TimeEntry,
} from "@goalslot/shared";

import { EmptyState, ErrorState, SkeletonListItem } from "@/components";
import { ReminderIntervalPicker } from "@/components/timer/ReminderIntervalPicker";
import { SessionHistory } from "@/components/timer/SessionHistory";
import { TimerControls } from "@/components/timer/TimerControls";
import { TimerRing } from "@/components/timer/TimerRing";
import { TrackingPicker } from "@/components/timer/TrackingPicker";
import { TrackingTarget } from "@/components/timer/TrackingTarget";
import { TrackerVoiceButton } from "@/components/voice/TrackerVoiceButton";
import { useTimerNotification } from "@/components/timer/useTimerNotification";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion, hapticLight } from "@/lib/haptics";
import { outbox } from "@/lib/offline";
import { goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useSettingsStore } from "@/lib/settings-store";
import { useTimerStore, type TimerStatus } from "@/lib/timer-store";
import { useTimerReminders } from "@/lib/useTimerReminders";
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
 * The name a session is logged under when there is no task or goal title to
 * use — either because the user deliberately tracked without attaching
 * anything (now the common case) or because a target was set but never
 * resolved. Matches the fallback wording useTimerNotification.ts uses.
 *
 * One string covers both because the entry itself keeps them apart: an
 * unattributed entry carries no goalId, an unresolved one does. Inventing a
 * second placeholder would put two near-identical strings in the user's
 * history that mean the same thing to them.
 *
 * `taskName` is required and non-empty by both createTimeEntrySchema and the
 * API's CreateTimeEntryDto, so some string has to be sent here; only
 * `taskTitle` (the denormalised snapshot of a real task's title) is left
 * unset, which is what keeps a placeholder out of the reporting field.
 */
const UNRESOLVED_TARGET_LABEL = "Focus session";

/** Matches `hasResponse` in src/hooks/useQuickAdd.ts and packages/shared/src/offline/sync.ts. */
function hasResponse(err: unknown): boolean {
  return Boolean((err as { response?: unknown } | undefined)?.response);
}

/**
 * What the tracking picker is currently choosing for: the live session
 * (whether idle-and-not-yet-started or already running), or a specific entry
 * already in the history that the user is filing after the fact.
 */
type PickerTarget = { kind: "session" } | { kind: "entry"; entry: TimeEntry };

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
  const retarget = useTimerStore((s) => s.retarget);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const stop = useTimerStore((s) => s.stop);

  const reminderIntervalMinutes = useSettingsStore((s) => s.timerReminderIntervalMinutes);
  const setReminderIntervalMinutes = useSettingsStore((s) => s.setTimerReminderIntervalMinutes);

  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  // Which already-logged entry is mid-attach, so its history row can show
  // the in-flight state instead of the list looking inert for a round trip.
  const [attachingEntryId, setAttachingEntryId] = useState<string | null>(null);
  // What the *next* run will be tracked against, chosen before pressing
  // Start. Once running, the store's own taskId/goalId is the source of truth
  // instead — this only matters pre-start.
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

  // Null here means "there is no title to show", which since one-tap
  // tracking landed covers two genuinely different situations: nothing is
  // attached (the ordinary case now), or something is attached but hasn't
  // resolved yet on a cold start. `hasTarget` is what tells them apart —
  // TrackingTarget needs both to pick its copy, and conflating them would
  // label a deliberately unattributed session "Untitled", which reads as a
  // failure rather than a choice.
  //
  // No placeholder is substituted here any more. It used to be, which meant
  // a running session with nothing attached rendered as though it were
  // tracking a thing called "Focus session". The placeholder now lives only
  // where it is genuinely needed: the API's required `taskName` (see
  // handleStop) and the notification's own `label ?? "Focus session"`.
  const knownLabel = resolvedLabel ?? latchedLabel;
  const activeLabel = knownLabel;
  const hasTarget =
    status === "idle"
      ? selectedTask !== null || selectedGoal !== null
      : timerTaskId !== null || timerGoalId !== null;
  const activeColor = activeGoal?.color ?? activeTask?.goal?.color ?? null;
  // A task shows its parent goal; a goal shows its category — either way the
  // second line answers "which bucket does this belong to?".
  const activeSublabel = activeTask ? (activeTask.goal?.title ?? null) : (activeGoal?.category ?? null);

  // Puts a persistent entry in the notification shade for the life of the
  // session, so a running timer is visible from outside the app. Degrades to
  // nothing at all if notification permission is refused.
  useTimerNotification({ status, startedAt, pausedElapsedMs, label: activeLabel });

  // The recurring "still strictly focused?" nudge, ported from web's
  // REMINDER control. Separate from the ongoing shade entry above: these are
  // future-dated notifications handed to the OS so they still arrive while
  // the app is suspended. Also degrades to nothing if permission is refused.
  //
  // `activeLabel` can now be null for a session the user deliberately started
  // without attaching anything, where before it was only ever null during the
  // brief cold-start gap before a target resolved. Both land on the same
  // branch: describeTimerReminder() substitutes "Focus session", the same
  // wording the shade entry uses, so a reminder for an unattributed session
  // reads "You are working on: Focus session" rather than leaking an empty
  // string or "undefined".
  useTimerReminders({ status, startedAt, label: activeLabel });

  /**
   * Files an already-logged entry under a goal/task after the fact. This is
   * the other half of one-tap tracking: if attribution is optional up front,
   * there has to be a cheap way to add it later, or "later" never happens.
   *
   * PUT /time-entries/:id already accepts goalId and taskId and recalculates
   * progress on both the old and the new goal (see the API's
   * time-entries.service.ts) — no backend change was needed for this.
   */
  const attachToEntry = useCallback(
    async (entry: TimeEntry, patch: { taskId?: string; taskTitle?: string; goalId?: string }) => {
      setAttachingEntryId(entry.id);
      try {
        await apiClient.timeEntries.update(entry.id, updateTimeEntrySchema.parse(patch));
        hapticCompletion();
        void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
        // The goal's logged hours move with the entry, so the goal list is
        // stale too — Reports and Today both read it.
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      } catch {
        Alert.alert("Couldn't attach that", "Your logged time is safe. Please try again.");
      } finally {
        setAttachingEntryId(null);
      }
    },
    [],
  );

  const handlePickTask = useCallback(
    (task: Task) => {
      const target = pickerTarget;
      setPickerTarget(null);
      if (target?.kind === "entry") {
        void attachToEntry(target.entry, {
          taskId: task.id,
          taskTitle: task.title,
          ...(task.goalId ? { goalId: task.goalId } : {}),
        });
        return;
      }
      setSelectedTask(task);
      setSelectedGoal(null);
      // A session already in flight gets re-pointed in the store; the local
      // selection above only governs the *next* start.
      retarget(task.id, task.goalId);
    },
    [attachToEntry, pickerTarget, retarget],
  );

  const handlePickGoal = useCallback(
    (goal: Goal) => {
      const target = pickerTarget;
      setPickerTarget(null);
      if (target?.kind === "entry") {
        void attachToEntry(target.entry, { goalId: goal.id });
        return;
      }
      setSelectedGoal(goal);
      setSelectedTask(null);
      retarget(undefined, goal.id);
    },
    [attachToEntry, pickerTarget, retarget],
  );

  /** "Just track time" — clears the target, pre-start or mid-run. */
  const handlePickNone = useCallback(() => {
    setPickerTarget(null);
    setSelectedTask(null);
    setSelectedGoal(null);
    retarget(undefined, undefined);
  }, [retarget]);

  const handleStart = useCallback(() => {
    // No guard. Pressing Start with nothing selected is the point: the timer
    // begins immediately and the session can be attributed during the run or
    // from its history row afterwards — or left unattributed for good.
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
    // Only a title we actually resolved is fit to persist. Null is the normal
    // case for an unattributed session and also covers the cold-start gap
    // where a target exists but never resolved; either way, writing the
    // "Focus session" placeholder into `taskTitle` would put a made-up value
    // in the field reporting treats as a real task's denormalised title.
    const stoppedTitle = knownLabel;
    const label = stoppedTitle ?? UNRESOLVED_TARGET_LABEL;

    const elapsed = stop();
    const elapsedSeconds = Math.round(elapsed / 1000);
    // The API requires at least 1 minute (see validation/time-entry.ts) —
    // round to the nearest minute but never log a zero-minute entry for a
    // timer that genuinely ran.
    const durationMinutes = Math.max(1, Math.round(elapsed / 60000));

    // Parsed inside its own guard, not inline at the call site: the store has
    // already been reset by `stop()` above, so an exception escaping here
    // would take the elapsed time with it AND leave `stopping` latched true,
    // which disables the Stop button for the rest of the app session.
    let payload: CreateTimeEntryInput;
    try {
      payload = createTimeEntrySchema.parse({
        // Always a non-empty string — see UNRESOLVED_TARGET_LABEL. For a
        // session tracked against nothing this is the only name the entry
        // gets, and it is deliberately a plain human phrase rather than a
        // marker like "(no goal)": the row it renders should read as a real
        // session, because it is one.
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
    } catch {
      stopping.current = false;
      Alert.alert(
        "Couldn't save time entry",
        `${formatDuration(durationMinutes)} was tracked but couldn't be prepared for saving. Please add it manually.`,
      );
      return;
    }

    const submit = async () => {
      await apiClient.timeEntries.create(payload);
      hapticCompletion();
      analytics.track({
        name: "timerStopped",
        payload: { taskId: stoppedTaskId, durationSeconds: elapsedSeconds },
      });
      setSelectedTask(null);
      setSelectedGoal(null);
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      if (stoppedGoalId) {
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      }
    };

    try {
      await submit();
    } catch (err) {
      // Offline or a timeout — the server never saw this. Bank it in the
      // outbox and let the sync engine replay it on reconnect, the same
      // treatment quick-add gives its creates. This matters more here than
      // anywhere else in the app: a goal the user typed can be typed again,
      // but elapsed time that was measured and then dropped is unrecoverable,
      // and the old Retry/Discard alert put a "Discard" button directly
      // between the user and their own measured time.
      if (!hasResponse(err)) {
        await outbox.addToOutbox({
          id: genId(),
          kind: "time-entry-create",
          payload,
          idempotencyKey: genId(),
          createdAt: Date.now(),
          retries: 0,
        });
        setSelectedTask(null);
        setSelectedGoal(null);
        Alert.alert(
          "Saved offline",
          `${formatDuration(durationMinutes)} is queued and will sync the next time you're online.`,
        );
        return;
      }

      // The server responded and refused. Replaying a payload it has already
      // rejected won't help, so this keeps the manual retry — and names the
      // duration either way, so the session can be re-entered by hand if the
      // retry fails too.
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

  // The picker serves three jobs from one sheet — setting up the next run,
  // re-pointing a live one, and filing an entry that's already in history —
  // so what counts as "currently selected" depends on which one opened it.
  const pickerMode =
    pickerTarget?.kind === "entry" ? "logged" : status === "idle" ? "prestart" : "running";
  const pickerSelectedId =
    pickerTarget?.kind === "entry"
      ? (pickerTarget.entry.taskId ?? pickerTarget.entry.goalId ?? null)
      : status === "idle"
        ? (selectedTask?.id ?? selectedGoal?.id ?? null)
        : (timerTaskId ?? timerGoalId);

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
          hasTarget={hasTarget}
          running={status !== "idle"}
          onPress={() => setPickerTarget({ kind: "session" })}
        />

        <ReminderIntervalPicker
          value={reminderIntervalMinutes}
          disabled={status === "running"}
          onChange={setReminderIntervalMinutes}
        />

        <TimerControls
          status={status}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={() => void handleStop()}
        />
      </View>

      {/* Tracking-scoped voice control. Self-contained — it reads the timer
          store and the goal/task lists itself — except for stopping, which
          is handed back to this screen's own handler so there stays exactly
          one path that writes a TimeEntry. See the component's header for
          why this mic behaves differently from the one in the tab bar. */}
      <TrackerVoiceButton onStopSession={() => void handleStop()} />

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
            description="Just press start — logged sessions land here. Attaching a goal is optional."
          />
        ) : (
          <SessionHistory
            entries={recentQuery.data}
            refreshing={recentQuery.isFetching && !recentQuery.isPending}
            onRefresh={() => void recentQuery.refetch()}
            onAttachGoal={(entry) => setPickerTarget({ kind: "entry", entry })}
            attachingEntryId={attachingEntryId}
          />
        )}
      </View>

      <TrackingPicker
        visible={pickerTarget !== null}
        tasks={tasksQuery.data ?? []}
        goals={goalsQuery.data ?? []}
        selectedId={pickerSelectedId}
        mode={pickerMode}
        onPickTask={handlePickTask}
        onPickGoal={handlePickGoal}
        onPickNone={handlePickNone}
        onClose={() => setPickerTarget(null)}
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
