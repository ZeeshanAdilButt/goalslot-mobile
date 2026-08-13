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
//
// SECOND SOURCE OF TRUTH: dw-time-api's PR #72/#73 added a cross-device
// `ActiveTimerSession` (`/timer/session`) that the Coach's voice/chat
// START_TIMER/STOP_TIMER actions write to directly. This screen used to
// know nothing about it — the local zustand store below was the only place
// a running timer could exist, so a session started from the Coach screen
// was completely invisible here, and pressing Start built a second,
// independent local session against the same goal. `serverSessionQuery`
// polls for one and, whenever it finds one, takes over as the source of
// truth for status/elapsed/attribution (see `effectiveStatus` and friends,
// just below the queries) and for what Start/Pause/Resume/Stop actually do.
// The local store is untouched by any of this — a user who never touches
// the Coach's timer actions still gets the exact local-only flow this
// screen always had.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
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
import { isPlanLimitError, hasReachedDailyEntryCap } from "@/lib/plan-limit";
import { goalQueries, taskQueries, timeEntryQueries, timerSessionQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_SESSION_LABEL } from "@/lib/session-label";
import { useSettingsStore } from "@/lib/settings-store";
import { getElapsedMs, useTimerStore, type TimerStatus } from "@/lib/timer-store";
import { useTimerReminders } from "@/lib/useTimerReminders";
import { useAuth } from "@/providers/auth-provider";
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
 * resolved. Matches the fallback wording useTimerNotification.ts uses — both
 * import the same constant, see src/lib/session-label.ts.
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
const UNRESOLVED_TARGET_LABEL = DEFAULT_SESSION_LABEL;

/** How often to poll for a server-side session while this screen is mounted. See the header note above. */
const SERVER_SESSION_POLL_MS = 20_000;

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
  const { user } = useAuth();

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

  // The other possible source of truth — see this file's header. `null`
  // (not an error) is what the endpoint returns when nothing is running, so
  // `serverSession` below is exactly that: a session, or nothing.
  const serverSessionQuery = useQuery({
    ...timerSessionQueries.active(),
    refetchInterval: SERVER_SESSION_POLL_MS,
  });
  const serverSession = serverSessionQuery.data ?? null;
  const hasServerSession = serverSession !== null;

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "timer" } });
      // Tabs stay mounted in this app (see TrackerVoiceButton.tsx's header),
      // so the query's own on-mount fetch only ever catches the first time
      // this tab is opened. Re-checking on every focus is what catches
      // "started tracking from the Coach screen, then switched to this tab".
      void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
    }, [analytics]),
  );

  // Belt-and-braces for the case a focus event doesn't fire on its own — the
  // app coming back from the background while already sitting on this tab.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      }
    });
    return () => subscription.remove();
  }, []);

  // The server session, normalised into the same {status, startedAt,
  // pausedElapsedMs} shape the local store already uses, so every hook and
  // every bit of render logic below this point can stay written in terms of
  // ONE timer instead of branching everywhere. When a server session exists
  // it is authoritative — same rule the local store used to have to itself.
  const effectiveStatus: TimerStatus = hasServerSession
    ? serverSession.status === "RUNNING"
      ? "running"
      : "paused"
    : status;
  const effectiveStartedAt =
    hasServerSession && serverSession.status === "RUNNING" && serverSession.segmentStartedAt !== null
      ? new Date(serverSession.segmentStartedAt).getTime()
      : hasServerSession
        ? null
        : startedAt;
  const effectivePausedElapsedMs = hasServerSession ? serverSession.accumulatedMs : pausedElapsedMs;
  const effectiveTaskId = hasServerSession ? (serverSession.taskId ?? null) : timerTaskId;
  const effectiveGoalId = hasServerSession ? (serverSession.goalId ?? null) : timerGoalId;

  // Lets the iOS home-screen widget's "Start" button (see
  // targets/widget/GoalSlotWidget.swift) jump straight into tracking instead
  // of just opening the app to this tab — see deep-links.ts's
  // `timerAutoStartDeepLink`. Guarded by a ref rather than clearing the
  // params: this screen can remount (tab switch) while the params are still
  // in the URL, and firing `start()` a second time against an already-
  // running timer would silently reset its elapsed time.
  //
  // Gated on `effectiveStatus`, not the local store's own `status`: a
  // server-side session (see this file's header) is just as much "already
  // running" as a local one, and without this the widget's Start button
  // would be a fifth way (alongside the on-screen Start button, the tracking
  // voice command, and the picker's mid-session handlers) to spin up a
  // redundant local session while one is already active elsewhere.
  const { autostart, goalId: autoStartGoalId } = useLocalSearchParams<{ autostart?: string; goalId?: string }>();
  const autoStartFired = useRef(false);
  useEffect(() => {
    if (autostart !== "1" || !autoStartGoalId || autoStartFired.current || effectiveStatus !== "idle") return;
    autoStartFired.current = true;
    start(undefined, autoStartGoalId);
    hapticLight();
    analytics.track({ name: "timerStarted", payload: { taskId: undefined } });
  }, [analytics, autoStartGoalId, autostart, effectiveStatus, start]);

  // What's actually being tracked right now — resolved from whichever ids
  // are authoritative against the loaded task/goal lists, so this is correct
  // even right after an app restart (before this screen ever set local
  // picker state). Falls back to the pre-start local selection while idle.
  const activeTask = useMemo(
    () =>
      tasksQuery.data?.find((t) => t.id === effectiveTaskId) ?? (effectiveStatus === "idle" ? selectedTask : null),
    [tasksQuery.data, effectiveTaskId, effectiveStatus, selectedTask],
  );
  const activeGoal = useMemo(
    () =>
      goalsQuery.data?.find((g) => g.id === effectiveGoalId) ?? (effectiveStatus === "idle" ? selectedGoal : null),
    [goalsQuery.data, effectiveGoalId, effectiveStatus, selectedGoal],
  );
  // A server session already carries its own denormalised `taskName` (set at
  // start, or by a PATCH from this screen or the Coach) — falling back to it
  // means an unattributed-but-named server session ("log this as 'gym'")
  // shows that name here even before/without a matching local task or goal.
  const resolvedLabel = activeTask?.title ?? activeGoal?.title ?? (hasServerSession ? serverSession.taskName : null);

  // The store persists only ids, so a running session's title has to be
  // looked up in the task/goal lists — and those lists can be momentarily
  // absent (cold start before the first fetch lands, or a cache eviction
  // mid-session). Latching the last title we successfully resolved for THIS
  // pair of ids stops the hero row, the shade notification and — the part
  // that actually mattered — the entry we eventually POST from degrading to
  // "Untitled session" just because a list request happens to be in flight.
  // The key guard is what makes it safe: a latch from a previous target can
  // never be shown against a new one.
  const targetKey = `${effectiveTaskId ?? ""}|${effectiveGoalId ?? ""}`;
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
  // tracking a thing called "Untitled session". The placeholder now lives
  // only where it is genuinely needed: the API's required `taskName` (see
  // handleStop) and the notification's own `label ?? "Untitled session"`.
  const knownLabel = resolvedLabel ?? latchedLabel;
  const activeLabel = knownLabel;
  const hasTarget =
    effectiveStatus === "idle"
      ? selectedTask !== null || selectedGoal !== null
      : effectiveTaskId !== null || effectiveGoalId !== null;
  const activeColor =
    activeGoal?.color ?? activeTask?.goal?.color ?? (hasServerSession ? (serverSession.goal?.color ?? null) : null);
  // A task shows its parent goal; a goal shows its category — either way the
  // second line answers "which bucket does this belong to?".
  const activeSublabel = activeTask ? (activeTask.goal?.title ?? null) : (activeGoal?.category ?? null);

  // Puts a persistent entry in the notification shade for the life of the
  // session, so a running timer is visible from outside the app. Degrades to
  // nothing at all if notification permission is refused.
  useTimerNotification({
    status: effectiveStatus,
    startedAt: effectiveStartedAt,
    pausedElapsedMs: effectivePausedElapsedMs,
    label: activeLabel,
  });

  // The recurring "still strictly focused?" nudge, ported from web's
  // REMINDER control. Separate from the ongoing shade entry above: these are
  // future-dated notifications handed to the OS so they still arrive while
  // the app is suspended. Also degrades to nothing if permission is refused.
  //
  // `activeLabel` can now be null for a session the user deliberately started
  // without attaching anything, where before it was only ever null during the
  // brief cold-start gap before a target resolved. Both land on the same
  // branch: describeTimerReminder() substitutes "Untitled session", the same
  // wording the shade entry uses, so a reminder for an unattributed session
  // reads "You are working on: Untitled session" rather than leaking an empty
  // string or "undefined".
  useTimerReminders({ status: effectiveStatus, startedAt: effectiveStartedAt, label: activeLabel });

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
      if (hasServerSession) {
        // Re-points the SERVER session — a local `retarget()` here would
        // change nothing the server (or another device watching the same
        // session) can see. Elapsed time is untouched either way; the PATCH
        // only ever changes attribution (see dw-time-api's
        // ActiveTimerService#updateAttribution).
        void apiClient.timerSession
          .update({ taskId: task.id, goalId: task.goalId ?? null, taskName: task.title })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          })
          .catch(() => {
            Alert.alert("Couldn't attach that", "Please try again.");
          });
        return;
      }
      setSelectedTask(task);
      setSelectedGoal(null);
      // A session already in flight gets re-pointed in the store; the local
      // selection above only governs the *next* start.
      retarget(task.id, task.goalId);
    },
    [attachToEntry, hasServerSession, pickerTarget, retarget],
  );

  const handlePickGoal = useCallback(
    (goal: Goal) => {
      const target = pickerTarget;
      setPickerTarget(null);
      if (target?.kind === "entry") {
        void attachToEntry(target.entry, { goalId: goal.id });
        return;
      }
      if (hasServerSession) {
        void apiClient.timerSession
          .update({ goalId: goal.id, taskId: null })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          })
          .catch(() => {
            Alert.alert("Couldn't attach that", "Please try again.");
          });
        return;
      }
      setSelectedGoal(goal);
      setSelectedTask(null);
      retarget(undefined, goal.id);
    },
    [attachToEntry, hasServerSession, pickerTarget, retarget],
  );

  /** "Just track time" — clears the target, pre-start or mid-run. */
  const handlePickNone = useCallback(() => {
    setPickerTarget(null);
    setSelectedTask(null);
    setSelectedGoal(null);
    if (hasServerSession) {
      void apiClient.timerSession
        .update({ taskId: null, goalId: null })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
        })
        .catch(() => {
          Alert.alert("Couldn't clear that", "Please try again.");
        });
      return;
    }
    retarget(undefined, undefined);
  }, [hasServerSession, retarget]);

  const handleStart = useCallback(() => {
    // A server session already showing as running/paused means TimerControls
    // never renders a Start button in the first place (see effectiveStatus).
    // This only guards the same-frame race right after the session query
    // first resolves — belt-and-braces, not the primary defence.
    if (hasServerSession) return;

    const maxTasksPerDay = user?.limits?.maxTasksPerDay;
    const todaysEntryCount = (recentQuery.data ?? []).filter(
      (entry) => entry.date.slice(0, 10) === getLocalDateString(),
    ).length;

    const beginSession = () => {
      // No target gate. Pressing Start with nothing selected is the point:
      // the timer begins immediately and the session can be attributed
      // during the run or from its history row afterwards — or left
      // unattributed for good.
      start(selectedTask?.id, selectedTask?.goalId ?? selectedGoal?.id);
      hapticLight();
      analytics.track({ name: "timerStarted", payload: { taskId: selectedTask?.id } });
    };

    // A soft warning, not a hard gate — one-tap tracking is the whole point
    // of this screen, and a user who's about to upgrade or roll into a new
    // day shouldn't be blocked from starting. This only tells them ahead of
    // time that today's save will fail as things stand, rather than letting
    // them find out after tracking and pressing Stop (see handleStop's
    // isPlanLimitError branch for what happens when this warning is skipped,
    // dismissed, or simply doesn't apply — e.g. another device or the Coach
    // pushes them over the cap mid-session).
    if (hasReachedDailyEntryCap(todaysEntryCount, maxTasksPerDay)) {
      Alert.alert(
        "You're at today's tracking limit",
        `Your plan saves up to ${maxTasksPerDay} tracked sessions a day, and you've already logged ${todaysEntryCount}. You can still start this timer, but stopping it won't save until you upgrade or a new day begins.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Start Anyway", onPress: beginSession },
        ],
      );
      return;
    }

    beginSession();
  }, [analytics, hasServerSession, recentQuery.data, selectedGoal, selectedTask, start, user]);

  const handlePause = useCallback(() => {
    if (hasServerSession) {
      void apiClient.timerSession
        .pause()
        .then(() => {
          hapticLight();
          analytics.track({ name: "timerPaused", payload: { taskId: serverSession?.taskId ?? undefined } });
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
        })
        .catch(() => {
          Alert.alert("Couldn't pause", "Please check your connection and try again.");
        });
      return;
    }
    pause();
    hapticLight();
    analytics.track({ name: "timerPaused", payload: { taskId: timerTaskId ?? undefined } });
  }, [analytics, hasServerSession, pause, serverSession, timerTaskId]);

  const handleResume = useCallback(() => {
    if (hasServerSession) {
      void apiClient.timerSession
        .resume()
        .then(() => {
          hapticLight();
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
        })
        .catch(() => {
          Alert.alert("Couldn't resume", "Please check your connection and try again.");
        });
      return;
    }
    resume();
    hapticLight();
  }, [hasServerSession, resume]);

  // `stop()` used to reset the local store synchronously, so a second press
  // could only land inside the same frame as the first — but two fingers do
  // exactly that. This guard is what stops a double stop, both for the local
  // store (which no longer resets up front — see handleStop below) and for
  // the server path (whose delete-then-create is already transactionally
  // double-stop-safe server-side, but there is no reason to fire the request
  // twice). A ref (not state) because it has to be readable before the
  // re-render.
  const stopping = useRef(false);

  const handleStop = useCallback(async () => {
    if (stopping.current || effectiveStatus === "idle") return;
    stopping.current = true;

    // ---- a server-side session is authoritative: stop IT, not the local store ----
    if (hasServerSession && serverSession) {
      const submitServerStop = async () => {
        const res = await apiClient.timerSession.stop({});
        hapticCompletion();
        analytics.track({
          name: "timerStopped",
          payload: {
            taskId: serverSession.taskId ?? undefined,
            durationSeconds: Math.round(res.data.elapsedMs / 1000),
          },
        });
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
        void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
        if (res.data.timeEntry.goalId) {
          void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
        }
      };

      try {
        await submitServerStop();
      } catch {
        // ActiveTimerService#stop deletes the session row and writes the
        // TimeEntry inside one transaction (dw-time-api's active-timer.service.ts)
        // — a request that fails here, for any reason, has left the session
        // exactly as it was. There is nothing local to protect and nothing
        // destructive about a plain retry, unlike the local-store path below.
        Alert.alert(
          "Couldn't save that session",
          "It's still safe — the session is still active on the server. Check your connection and try again.",
          [
            { text: "OK", style: "cancel" },
            {
              text: "Retry",
              onPress: () => {
                stopping.current = true;
                void submitServerStop()
                  .catch(() => {
                    Alert.alert("Still couldn't save", "The session is still active on the server — try again shortly.");
                  })
                  .finally(() => {
                    stopping.current = false;
                  });
              },
            },
          ],
        );
      } finally {
        stopping.current = false;
      }
      return;
    }

    // ---- purely local session ----

    // Capture what was actually running WITHOUT touching the store yet.
    const stoppedTaskId = timerTaskId ?? undefined;
    const stoppedGoalId = activeTask?.goalId ?? timerGoalId ?? undefined;
    const stoppedStartedAt = startedAt;
    // Only a title we actually resolved is fit to persist. Null is the normal
    // case for an unattributed session and also covers the cold-start gap
    // where a target exists but never resolved; either way, writing the
    // "Untitled session" placeholder into `taskTitle` would put a made-up
    // value in the field reporting treats as a real task's denormalised
    // title.
    const stoppedTitle = knownLabel;
    const label = stoppedTitle ?? UNRESOLVED_TARGET_LABEL;

    // A PURE snapshot — not a store mutation (see getElapsedMs's own doc
    // comment). `stop()`, which actually resets the store, is only called
    // once the save has either succeeded or been durably queued offline —
    // see `finalizeLocalStop` below. This is the fix for the bug where
    // stopping a timer after hitting the free-plan daily entry cap destroyed
    // the tracked time with no way to get it back: the old code called
    // `stop()` here, before knowing whether the POST below would even
    // succeed, so a 403 arrived with the elapsed time already gone.
    const elapsed = getElapsedMs({ status, startedAt, pausedElapsedMs });
    const elapsedSeconds = Math.round(elapsed / 1000);
    // The API requires at least 1 minute (see validation/time-entry.ts) —
    // round to the nearest minute but never log a zero-minute entry for a
    // timer that genuinely ran.
    const durationMinutes = Math.max(1, Math.round(elapsed / 60000));

    // Parsed inside its own guard: an exception here must not leave
    // `stopping` latched true, which would disable the Stop button for the
    // rest of the app session.
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
        // wall-clock start alongside the duration.
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

    // The ONLY place the local store actually resets. Called once the entry
    // is confirmed saved, durably queued offline, or the user explicitly
    // discards it — never merely because the server rejected a save, so a
    // rejected save (the plan-limit cap being the common case) can never
    // take the elapsed time down with it.
    const finalizeLocalStop = () => {
      stop();
      setSelectedTask(null);
      setSelectedGoal(null);
    };

    const submit = async () => {
      await apiClient.timeEntries.create(payload);
      hapticCompletion();
      analytics.track({
        name: "timerStopped",
        payload: { taskId: stoppedTaskId, durationSeconds: elapsedSeconds },
      });
      finalizeLocalStop();
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      if (stoppedGoalId) {
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      }
    };

    // Shared by the first attempt and every Retry: re-derives which alert to
    // show from whatever error just came back, rather than assuming a retry
    // fails the same way the first attempt did. Discard is now the only path
    // that actually clears the store — before this rewrite the store had
    // already been reset by the time any of these alerts appeared, so
    // "Discard" was really just "dismiss".
    const presentSaveFailureAlert = (err: unknown) => {
      const runningWord = status === "paused" ? "paused" : "running";

      if (isPlanLimitError(err)) {
        const capWord = Number.isFinite(user?.limits?.maxTasksPerDay)
          ? `today's free-plan limit of ${user?.limits?.maxTasksPerDay} tracked sessions`
          : "today's plan limit for tracked sessions";
        Alert.alert(
          "Can't save this session yet",
          `You've reached ${capWord}. ${formatDuration(durationMinutes)} against "${label}" is still safe — your timer is still ${runningWord}, nothing is lost. Upgrade to save it now, or it'll be available to save after midnight.`,
          [
            { text: "Keep Tracking", style: "cancel" },
            { text: "Discard", style: "destructive", onPress: finalizeLocalStop },
            {
              text: "Retry",
              onPress: () => {
                stopping.current = true;
                void submit()
                  .catch(presentSaveFailureAlert)
                  .finally(() => {
                    stopping.current = false;
                  });
              },
            },
          ],
        );
        return;
      }

      Alert.alert(
        "Couldn't save time entry",
        `Your timer is still ${runningWord}. ${formatDuration(durationMinutes)} against "${label}" hasn't been saved yet.`,
        [
          { text: "Keep Tracking", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: finalizeLocalStop },
          {
            text: "Retry",
            onPress: () => {
              stopping.current = true;
              void submit()
                .catch(presentSaveFailureAlert)
                .finally(() => {
                  stopping.current = false;
                });
            },
          },
        ],
      );
    };

    try {
      await submit();
    } catch (err) {
      // Offline or a timeout — the server never saw this. Bank it in the
      // outbox and let the sync engine replay it on reconnect, the same
      // treatment quick-add gives its creates. This matters more here than
      // anywhere else in the app: a goal the user typed can be typed again,
      // but elapsed time that was measured and then dropped is unrecoverable.
      if (!hasResponse(err)) {
        await outbox.addToOutbox({
          id: genId(),
          kind: "time-entry-create",
          payload,
          idempotencyKey: genId(),
          createdAt: Date.now(),
          retries: 0,
        });
        // Durably queued — safe to reset now, the sync engine owns delivery
        // from here.
        finalizeLocalStop();
        Alert.alert(
          "Saved offline",
          `${formatDuration(durationMinutes)} is queued and will sync the next time you're online.`,
        );
        return;
      }

      // The server responded and refused. Replaying a payload it has already
      // rejected won't always help, but the store stays intact either way so
      // there's always something real to retry against.
      presentSaveFailureAlert(err);
    } finally {
      stopping.current = false;
    }
  }, [
    activeTask,
    analytics,
    effectiveStatus,
    hasServerSession,
    knownLabel,
    pausedElapsedMs,
    serverSession,
    startedAt,
    status,
    stop,
    timerGoalId,
    timerTaskId,
    user,
  ]);

  // The picker serves three jobs from one sheet — setting up the next run,
  // re-pointing a live one, and filing an entry that's already in history —
  // so what counts as "currently selected" depends on which one opened it.
  const pickerMode =
    pickerTarget?.kind === "entry" ? "logged" : effectiveStatus === "idle" ? "prestart" : "running";
  const pickerSelectedId =
    pickerTarget?.kind === "entry"
      ? (pickerTarget.entry.taskId ?? pickerTarget.entry.goalId ?? null)
      : effectiveStatus === "idle"
        ? (selectedTask?.id ?? selectedGoal?.id ?? null)
        : (effectiveTaskId ?? effectiveGoalId);

  const statusMeta = STATUS_META[effectiveStatus];
  const ringSize = Math.max(
    150,
    Math.min(MAX_RING_SIZE, width - RING_HORIZONTAL_INSET, height * RING_HEIGHT_FRACTION),
  );

  // Fixed wall-clock start beats a second copy of the elapsed count already
  // filling the middle of the ring.
  const ringCaption =
    effectiveStatus === "running" && effectiveStartedAt !== null
      ? `Started ${new Date(effectiveStartedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : effectiveStatus === "paused"
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
          <Text style={[styles.statusPillText, effectiveStatus !== "idle" && { color: statusMeta.textColor }]}>
            {statusMeta.label}
          </Text>
        </View>

        <TimerRing
          status={effectiveStatus}
          startedAt={effectiveStartedAt}
          pausedElapsedMs={effectivePausedElapsedMs}
          size={ringSize}
          accentColor={activeColor}
          caption={ringCaption}
        />

        <TrackingTarget
          label={activeLabel}
          sublabel={activeSublabel}
          accentColor={activeColor}
          hasTarget={hasTarget}
          running={effectiveStatus !== "idle"}
          onPress={() => setPickerTarget({ kind: "session" })}
        />

        <ReminderIntervalPicker
          value={reminderIntervalMinutes}
          disabled={effectiveStatus === "running"}
          onChange={setReminderIntervalMinutes}
        />

        <TimerControls
          status={effectiveStatus}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={() => void handleStop()}
        />
      </View>

      {/* Tracking-scoped voice control. Self-contained — it reads the timer
          store and the goal/task lists itself — except for stopping, which
          is handed back to this screen's own handler so there stays exactly
          one path that writes a TimeEntry (or, now, stops a server session).
          `serverSessionActive` closes the same double-session gap through
          this entry point: without it, saying "start tracking X" while a
          server session is already running would create a second, purely
          local one via the voice path, the same bug this screen's own Start
          button is guarded against above. */}
      <TrackerVoiceButton onStopSession={() => void handleStop()} serverSessionActive={hasServerSession} />

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
