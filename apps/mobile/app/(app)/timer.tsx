// Time Tracker tab: start/pause/resume/stop a timer against a task or goal,
// then log it as a TimeEntry, plus a feed of recently logged sessions.
//
// The running-timer state lives in src/lib/timer-store.ts (a persisted
// zustand store) rather than here — this screen just renders that state.
// The once-a-second clock tick lives inside <TimerRing/> rather than here,
// so it doesn't re-render the whole screen every second.
//
// Product language and layout follow dw-time-web's time-tracker feature,
// re-presented natively (circular progress hero, round transport controls,
// day-grouped session list) rather than ported directly.
//
// This screen also polls for a cross-device `ActiveTimerSession`
// (`/timer/session`, written to by the Coach's voice/chat timer actions) via
// `serverSessionQuery`, and treats it as the source of truth for
// status/elapsed/attribution whenever one is present (see `effectiveStatus`
// and friends, just below the queries). The local store is untouched by any
// of this — a user who never touches the Coach's timer actions gets the
// exact local-only flow this screen always had.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
  namedTarget,
  resolveSpokenTarget,
  updateTimeEntrySchema,
  type CreateTimeEntryInput,
  type Goal,
  type Task,
  type TimeEntry,
} from "@goalslot/shared";

import { EmptyState, QueryErrorState, SkeletonListItem } from "@/components";
import { ReminderIntervalPicker } from "@/components/timer/ReminderIntervalPicker";
import { SessionHistory } from "@/components/timer/SessionHistory";
import { TimerControls } from "@/components/timer/TimerControls";
import { TimerRing } from "@/components/timer/TimerRing";
import { TrackingPicker } from "@/components/timer/TrackingPicker";
import { TrackingTarget } from "@/components/timer/TrackingTarget";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrackerVoiceButton } from "@/components/voice/TrackerVoiceButton";
import { buildTrackingCandidates } from "@/components/voice/tracking-commands";
import { useTimerNotification } from "@/components/timer/useTimerNotification";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { hapticCompletion, hapticLight } from "@/lib/haptics";
import { outbox } from "@/lib/offline";
import { isPlanLimitError, hasReachedDailyEntryCap } from "@/lib/plan-limit";
import { goalQueries, scheduleQueries, taskQueries, timeEntryQueries, timerSessionQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_SESSION_LABEL } from "@/lib/session-label";
import { useSettingsStore } from "@/lib/settings-store";
import {
  cleanLabel,
  firstFinite,
  isDormantLocalSession,
  isDormantServerSession,
  resolveScheduledTarget,
} from "@/lib/timer-attribution";
import { getElapsedMs, useTimerStore, type TimerStatus } from "@/lib/timer-store";
import { useTimerReminders } from "@/lib/useTimerReminders";
import { useAuth } from "@/providers/auth-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const RECENT_SKELETON_ROWS = 4;

/**
 * Same resolution `app/(app)/index.tsx` uses to drive the Today screen's
 * "FOCUS NOW" card (see its own `DEVICE_TIMEZONE` for the fuller "why not
 * device-local Date getters" rationale) — `resolveActiveBlock` needs an
 * explicit IANA zone, and this is the only one available without asking the
 * user to configure one.
 */
const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
 * What the tracking picker is currently choosing for: one of the live
 * session's two attribution slots (whether idle-and-not-yet-started or
 * already running), or a specific entry already in the history that the user
 * is filing after the fact.
 *
 * The slot is what makes goal and task independently settable — the sheet
 * opens listing only the thing that row is for, so "now also add a task"
 * isn't a second pass through a list that reads as "replace your goal".
 */
type PickerTarget = { kind: "session"; slot: "goal" | "task" } | { kind: "entry"; entry: TimeEntry };

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

const STATUS_META: Record<
  TimerStatus,
  { label: string; dotColor: string; pulse: boolean; textColor: string }
> = {
  idle: {
    label: "Ready to start",
    dotColor: colors.mutedForeground,
    pulse: false,
    textColor: colors.white,
  },
  running: {
    label: "Tracking",
    dotColor: colors.primary,
    pulse: true,
    textColor: colors.primary,
  },
  paused: {
    label: "Paused",
    dotColor: colors.primary,
    pulse: false,
    textColor: colors.primary,
  },
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

  const reminderIntervalMinutes = useSettingsStore(
    (s) => s.timerReminderIntervalMinutes,
  );
  const setReminderIntervalMinutes = useSettingsStore(
    (s) => s.setTimerReminderIntervalMinutes,
  );

  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  // Stable identity so it doesn't defeat SessionHistory's own row memoization
  // (SessionRow is memo()'d — an inline arrow recreated on every render of
  // this screen would make every visible row re-render regardless).
  const openAttachPicker = useCallback((entry: TimeEntry) => setPickerTarget({ kind: "entry", entry }), []);
  // Which already-logged entry is mid-attach, so its history row can show
  // the in-flight state instead of the list looking inert for a round trip.
  const [attachingEntryId, setAttachingEntryId] = useState<string | null>(null);
  // What the *next* run will be tracked against, chosen before pressing
  // Start. Once running, the store's own taskId/goalId is the source of truth
  // instead — this only matters pre-start.
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

  // The daily-cap warning shown on Start once today's tracked-session count
  // is already at the plan limit — see handleStart. Just the callback: the
  // copy is fixed, only whether it's showing (and what "Start Anyway" does)
  // varies.
  const [dailyCapWarning, setDailyCapWarning] = useState<{
    maxTasksPerDay: number | undefined;
    todaysEntryCount: number;
    onStartAnyway: () => void;
  } | null>(null);

  // The server-side stop failure dialog (handleStop's hasServerSession
  // branch). Unlike the local-stop failure below, there is nothing to
  // discard here — ActiveTimerService#stop is transactional, so a failed
  // request has left the session exactly as it was on the server. Only
  // Keep Tracking / Retry make sense.
  const [serverStopFailure, setServerStopFailure] = useState(false);
  const [serverStopBusy, setServerStopBusy] = useState(false);
  const [serverStopError, setServerStopError] = useState<string | null>(null);
  // The specific `submitServerStop` closure from the handleStop call that
  // just failed — a ref, not state, because it's a function: retrying means
  // re-running that exact request, not a fresh one built from whatever props
  // this render happens to have.
  const serverStopRetryRef = useRef<(() => Promise<void>) | null>(null);

  // The local-stop save-failure dialog (handleStop's purely-local branch).
  // Genuinely 3-way — Keep Tracking / Discard / Retry — because unlike the
  // server-stop case above, the elapsed time is sitting in this app's memory
  // only until one of those three actually resolves it.
  const [saveFailureDialog, setSaveFailureDialog] = useState<{
    title: string;
    description: string;
    onRetry: () => void;
    onDiscard: () => void;
  } | null>(null);
  const [saveFailureBusy, setSaveFailureBusy] = useState(false);
  const [saveFailureError, setSaveFailureError] = useState<string | null>(null);

  const tasksQuery = useQuery(taskQueries.list());
  const goalsQuery = useQuery(goalQueries.list());
  const recentQuery = useQuery(timeEntryQueries.recent());
  // Only fetched to drive the auto-select-on-open below — nothing else on
  // this screen reads a block's start/end/title, so there is no ring/countdown
  // UI here to keep updated live the way index.tsx's copy of this query does.
  const scheduleQuery = useQuery(scheduleQueries.weekly());

  // The other possible source of truth — see this file's header. `null`
  // (not an error) is what the endpoint returns when nothing is running, so
  // this is exactly that: a session, or nothing.
  const serverSessionQuery = useQuery({
    ...timerSessionQueries.active(),
    refetchInterval: SERVER_SESSION_POLL_MS,
  });
  const rawServerSession = serverSessionQuery.data ?? null;

  // A dormant session is excluded from `serverSession` entirely, so every
  // guard below just sees "no server session" — see isDormantServerSession
  // in timer-attribution.ts.
  const dormantServerSession = isDormantServerSession(rawServerSession) ? rawServerSession : null;
  const serverSession = dormantServerSession === null ? rawServerSession : null;
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
  // `serverSession.accumulatedMs` crosses the network with no runtime
  // validation despite its `number` type — a live case, not a hypothetical
  // one, produced a paused session whose ring read "NaN:NaN:NaN" instead of
  // a duration. `?? 0` here (not just inside getElapsedMs, which only
  // covers callers that route through it) is what protects
  // useTimerNotification below, which does its own `pausedElapsedMs / 60000`
  // arithmetic directly rather than through that helper.
  const effectivePausedElapsedMs = hasServerSession ? (serverSession.accumulatedMs ?? 0) : pausedElapsedMs;
  const effectiveTaskId = hasServerSession ? (serverSession.taskId ?? null) : timerTaskId;
  const effectiveGoalId = hasServerSession ? (serverSession.goalId ?? null) : timerGoalId;

  // See isDormantLocalSession in timer-attribution.ts. Unlike the server
  // flavour, this is shown on screen — transport controls still offer
  // Resume/Stop on it.
  const localDormant = isDormantLocalSession({
    status,
    pausedElapsedMs,
    taskId: timerTaskId,
    goalId: timerGoalId,
  });

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
  const { autostart, goalId: autoStartGoalId, spokenName } = useLocalSearchParams<{
    autostart?: string;
    goalId?: string;
    spokenName?: string;
  }>();
  // Shared across all three `autostart` variants below (this effect, and the
  // "active"/"spoken" ones further down) so that whichever one matches the
  // param fires exactly once, the same "fire, don't retrigger on remount"
  // guarantee a single ref gave the widget-only case before Android App
  // Actions added the other two shapes.
  const autoStartFired = useRef(false);
  useEffect(() => {
    if (autostart !== "1" || !autoStartGoalId || autoStartFired.current || effectiveStatus !== "idle") return;
    autoStartFired.current = true;
    start(undefined, autoStartGoalId);
    hapticLight();
    analytics.track({ name: "timerStarted", payload: { taskId: undefined } });
  }, [analytics, autoStartGoalId, autostart, effectiveStatus, start]);

  /**
   * `autostart=active` — the hand-off target for BOTH the "Hey Siri, start
   * timer in GoalSlot" App Shortcut (ios/GoalSlot/StartTimerIntent.swift)
   * and its Android App Actions equivalent (plugins/android-shortcuts.xml's
   * `start_timer` shortcut, wired via plugins/withAppActions.js). Neither
   * platform's voice trigger knows a goalId up front, so this resolves the
   * same "what's live right now" block the auto-select-on-open effect below
   * already computes (`resolveActiveBlock`) and, unlike that effect, calls
   * `start()` rather than merely `retarget()` — this deep link's whole
   * point is "start tracking without touching the screen".
   *
   * Deliberately does NOT alert when nothing is scheduled right now: the
   * screen is already open (this effect only runs once navigation has
   * landed here), so a silent no-op just leaves the user looking at the
   * ordinary idle Timer screen, free to pick a target and press Start
   * themselves — the same graceful degrade `timerAutoStartActiveDeepLink`'s
   * own doc comment in deep-links.ts describes.
   */
  useEffect(() => {
    if (autostart !== "active" || autoStartFired.current || effectiveStatus !== "idle") return;

    const scheduled = resolveScheduledTarget(
      scheduleQuery.data,
      goalsQuery.data,
      tasksQuery.data,
      new Date(),
      DEVICE_TIMEZONE,
    );
    if (!scheduled) return;

    // Re-check live state right before mutating, same race the
    // auto-select-on-open effect below guards against.
    if (useTimerStore.getState().status !== "idle" || hasServerSession) return;

    autoStartFired.current = true;
    start(scheduled.task?.id, scheduled.goal.id);
    hapticLight();
    analytics.track({ name: "timerStarted", payload: { taskId: scheduled.task?.id } });
  }, [analytics, autostart, effectiveStatus, goalsQuery.data, hasServerSession, scheduleQuery.data, start, tasksQuery.data]);

  /**
   * `autostart=spoken` — the hand-off target for both platforms' "start
   * timer for <name>" voice trigger (ios/GoalSlot/StartTimerForGoalIntent.swift
   * and android-shortcuts.xml's `actions.intent.OPEN_APP_FEATURE`
   * capability). `spokenName` is the raw words the assistant captured,
   * unparsed — resolved here the same way the in-app Voice tab and the Time
   * Tracker's own mic button do (`resolveSpokenTarget` /
   * `buildTrackingCandidates`, see tracking-commands.ts), so "start timer
   * for deen" behaves identically whether it came from a tap-and-hold on
   * the mic orb or from Assistant.
   *
   * Only ever auto-starts on a CONFIDENT match. An ambiguous or unresolved
   * name deliberately does not guess — same rule the rest of this app's
   * voice surface follows (see tracking-commands.ts's header) — and instead
   * leaves the screen open, idle and unattributed for the user to finish by
   * hand (the picker, or the in-app mic button), matching the degrade path
   * android-shortcuts.xml's own comment describes for this capability.
   */
  useEffect(() => {
    if (autostart !== "spoken" || !spokenName || autoStartFired.current || effectiveStatus !== "idle") return;
    if (!tasksQuery.data || !goalsQuery.data) return;
    if (useTimerStore.getState().status !== "idle" || hasServerSession) return;

    const candidates = buildTrackingCandidates(goalsQuery.data, tasksQuery.data);
    const resolution = resolveSpokenTarget(namedTarget("unspecified", spokenName), candidates);
    if (resolution.status !== "confident" || !resolution.target) return;

    autoStartFired.current = true;
    const target = resolution.target;
    const resolvedTaskId = target.kind === "task" ? target.id : undefined;
    const resolvedGoalId =
      target.kind === "goal" ? target.id : tasksQuery.data.find((t) => t.id === target.id)?.goalId;
    start(resolvedTaskId, resolvedGoalId);
    hapticLight();
    analytics.track({ name: "timerStarted", payload: { taskId: resolvedTaskId } });
  }, [analytics, autostart, effectiveStatus, goalsQuery.data, hasServerSession, spokenName, start, tasksQuery.data]);

  // True once the user has made a deliberate pick THIS visit to the screen
  // (via the tracking picker), which is what stops the auto-select effect
  // below from clobbering a choice they only just made — including "Just
  // track time", which clears both ids and would otherwise look identical to
  // "nothing selected yet" to that effect.
  const userSelectedRef = useRef(false);

  /**
   * FEATURE: auto-select-on-open — defaults the tracker to whatever schedule
   * block is live right now, matching `app/(app)/index.tsx`'s "FOCUS NOW"
   * card.
   *
   * Guarded four ways, all required:
   *   - `autostart` unset — otherwise one of the three deep-link effects
   *     above is about to call `start()` itself, and since a deep-link's
   *     `start()` mutates the store synchronously without forcing a
   *     re-render first, this effect could still see a stale "idle" in the
   *     same flush and call `retarget()` right after, overwriting the
   *     deep-link's target.
   *   - not idle AND not dormant — never re-point a session that's genuinely
   *     running or paused with something in it (local or server-side); a
   *     dormant session (isDormantServerSession / isDormantLocalSession) is
   *     the deliberate exception on both sides.
   *   - `userSelectedRef` — never override a pick the user already made this
   *     visit, including a deliberate "Just track time".
   *   - `selectedTask`/`selectedGoal` already set — covers a fast remount
   *     mid-session, and also means this effect naturally stops re-firing
   *     once it has picked something, without needing a separate one-shot
   *     latch (a latch would wrongly lock it out of picking up a *later*
   *     block after an earlier session ends).
   */
  useEffect(() => {
    if (
      autostart !== undefined ||
      (effectiveStatus !== "idle" && !localDormant) ||
      userSelectedRef.current ||
      selectedTask !== null ||
      selectedGoal !== null
    ) {
      return;
    }
    // `resolveScheduledTarget` waits for every list it needs to resolve ids
    // against — an undefined-vs-empty distinction matters (a still-loading
    // query is `undefined`, a genuinely empty one is `[]`), which is why it
    // takes the raw query data rather than a `?? []` fallback.
    const scheduled = resolveScheduledTarget(
      scheduleQuery.data,
      goalsQuery.data,
      tasksQuery.data,
      new Date(),
      DEVICE_TIMEZONE,
    );
    if (!scheduled) return;

    // Re-checks LIVE state right before mutating, not the `effectiveStatus`
    // closed over at render time: the local store rehydrates from
    // AsyncStorage asynchronously, and `hasServerSession` starts false until
    // the first query resolves, so a session already active before mount can
    // still read as stale "idle" here. `retarget()`'s own idle check can't
    // catch this — it protects the opposite direction (a truly idle store).
    const liveState = useTimerStore.getState();
    if ((liveState.status !== "idle" && !isDormantLocalSession(liveState)) || hasServerSession) return;

    // BOTH slots, not one or the other: the goal is what the block is for,
    // and the task (when the block names one) narrows it. Setting the goal
    // even in the task case is what lets the user drop the task later and
    // still be tracking against something.
    setSelectedGoal(scheduled.goal);
    setSelectedTask(scheduled.task);
    retarget(scheduled.task?.id, scheduled.goal.id);
  }, [
    autostart,
    effectiveStatus,
    goalsQuery.data,
    hasServerSession,
    localDormant,
    retarget,
    scheduleQuery.data,
    selectedGoal,
    selectedTask,
    tasksQuery.data,
  ]);

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
  // The two slots' own titles, each independently resolvable. EVERY one goes
  // through `cleanLabel`: these are unvalidated network strings, and an empty
  // one is "no title", not a title that happens to be empty. Skipping that is
  // exactly how the attribution row came to render as a blank box with a
  // "Change" affordance and nothing else in it.
  const goalTitle = cleanLabel(
    activeGoal?.title ?? activeTask?.goal?.title ?? (hasServerSession ? serverSession.goal?.title : null),
  );
  const taskTitle = cleanLabel(activeTask?.title ?? (hasServerSession ? serverSession.task?.title : null));
  // A server session also carries a denormalised free-text `taskName` (set at
  // start, or by a PATCH from this screen or the Coach), which is a session
  // NAME rather than a task — "log this as 'gym'" produces one with no task
  // or goal behind it. Kept separate from the two slots so it can't be
  // mistaken for a real task, but still shown (and still what the entry gets
  // named on stop).
  const sessionName = hasServerSession ? cleanLabel(serverSession.taskName) : null;
  const resolvedLabel = taskTitle ?? goalTitle ?? sessionName;

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
  if (resolvedLabel !== null)
    labelLatch.current = { key: targetKey, label: resolvedLabel };
  const latchedLabel =
    labelLatch.current?.key === targetKey ? labelLatch.current.label : null;

  // Null here means "there is no title to show", which since one-tap
  // tracking landed covers two genuinely different situations: nothing is
  // attached (the ordinary case now), or something is attached but hasn't
  // resolved yet on a cold start. The `*Unresolved` flags below are what tell
  // them apart — TrackingTarget needs that to pick its copy, and conflating
  // them would label a deliberately unattributed session "Untitled", which
  // reads as a failure rather than a choice.
  //
  // No placeholder is substituted here any more. It used to be, which meant
  // a running session with nothing attached rendered as though it were
  // tracking a thing called "Untitled session". The placeholder now lives
  // only where it is genuinely needed: the API's required `taskName` (see
  // handleStop) and the notification's own `label ?? "Untitled session"`.
  const knownLabel = resolvedLabel ?? latchedLabel;
  const activeLabel = knownLabel;

  // Which ids each slot is showing, from whichever source of truth owns them
  // right now. While idle that's the pre-start selection: the store
  // deliberately refuses to hold a target it isn't timing (see timer-store's
  // `retarget`), so its ids are null until Start.
  const slotTaskId = effectiveStatus === "idle" ? (selectedTask?.id ?? null) : effectiveTaskId;
  const slotGoalId =
    effectiveStatus === "idle"
      ? (selectedGoal?.id ?? selectedTask?.goalId ?? null)
      : (effectiveGoalId ?? activeTask?.goalId ?? null);
  // "An id is attached but we can't name it yet" — a cold start with the
  // goal/task lists still in flight, not an empty slot.
  const goalUnresolved = slotGoalId !== null && goalTitle === null;
  const taskUnresolved = slotTaskId !== null && taskTitle === null;

  const activeColor =
    activeGoal?.color ?? activeTask?.goal?.color ?? (hasServerSession ? (serverSession.goal?.color ?? null) : null);
  // The goal row's second line — which bucket this belongs to.
  const goalCategory = cleanLabel(activeGoal?.category);

  /**
   * The block that's live right now, offered as a one-tap attribution
   * whenever the goal slot is empty. This is the same resolution the
   * auto-select effect above performs, and it is deliberately still shown in
   * the cases that effect refuses to touch — above all a genuinely RUNNING
   * session with no goal, where silently re-attributing would be wrong but
   * offering the obvious answer is exactly right. Cheap enough to do on every
   * render (a plain array scan, no fetch), and doing it unmemoised is what
   * keeps it honest as the clock crosses out of one block and into the next.
   */
  const scheduledTarget = resolveScheduledTarget(
    scheduleQuery.data,
    goalsQuery.data,
    tasksQuery.data,
    new Date(),
    DEVICE_TIMEZONE,
  );

  // Puts a persistent entry in the notification shade for the life of the
  // session, so a running timer is visible from outside the app. Degrades to
  // nothing at all if notification permission is refused.
  //
  // A dormant local session is deliberately still shown on THIS screen (see
  // localDormant's own comment: honest Resume/Stop controls, costs nothing).
  // The shade is a different cost — a "Paused · Untitled session · 0m" entry
  // that outlives the screen and never clears itself reads as a real stuck
  // session even though nothing is actually running. So the notification
  // treats local dormancy as idle regardless of what the screen shows,
  // matching how a dormant SERVER session is already fully hidden above.
  const suppressDormantNotification = !hasServerSession && localDormant;
  useTimerNotification({
    status: suppressDormantNotification ? "idle" : effectiveStatus,
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
    async (
      entry: TimeEntry,
      patch: { taskId?: string; taskTitle?: string; goalId?: string },
    ) => {
      setAttachingEntryId(entry.id);
      try {
        await apiClient.timeEntries.update(
          entry.id,
          updateTimeEntrySchema.parse(patch),
        );
        hapticCompletion();
        void queryClient.invalidateQueries({
          queryKey: timeEntryQueries.timeEntryQueries.all,
        });
        // The goal's logged hours move with the entry, so the goal list is
        // stale too — Reports and Today both read it.
        void queryClient.invalidateQueries({
          queryKey: goalQueries.goalQueries.all,
        });
      } catch (err) {
        console.error(err);
        notify(getErrorMessage(err, "Couldn't attach that. Your logged time is safe."), "error", {
          action: { label: "Retry", onPress: () => void attachToEntry(entry, patch) },
        });
      } finally {
        setAttachingEntryId(null);
      }
    },
    [],
  );

  /**
   * PATCHes the server timer session's attribution, with one shared
   * carve-out: `/timer/session` is a singleton with no id (see
   * timer-session.ts's header), so this races any other device or a
   * server-side auto-stop that ends the session between when this screen
   * last synced `hasServerSession` and when the PATCH actually lands — the
   * API answers that with a 404. Offering the normal "Retry" action there
   * would just repeat the identical 404 forever (this is what produced a
   * stack of identical failing toasts from one tap in the field); resyncing
   * the query instead lets `hasServerSession` fall to its real value so the
   * next pick starts fresh rather than retrying a session that's gone.
   */
  const patchServerSession = useCallback(
    async (patch: Parameters<typeof apiClient.timerSession.update>[0], errorMessage: string, retry: () => void) => {
      try {
        await apiClient.timerSession.update(patch);
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      } catch (err) {
        console.error(err);
        const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
        if (status === 404) {
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          notify("That timer session already ended.", "error");
          return;
        }
        notify(getErrorMessage(err, errorMessage), "error", { action: { label: "Retry", onPress: retry } });
      }
    },
    [],
  );

  const handlePickTask = useCallback(
    (task: Task) => {
      const target = pickerTarget;
      setPickerTarget(null);
      userSelectedRef.current = true;
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
        void patchServerSession(
          { taskId: task.id, goalId: task.goalId ?? null, taskName: task.title },
          "Couldn't attach that task. Your timer is still running.",
          () => handlePickTask(task),
        );
        return;
      }
      // A task implies its goal, so picking one fills BOTH slots. Setting the
      // goal explicitly (rather than leaving it implied by the task) is what
      // lets "No task" later leave a goal still attached instead of silently
      // detaching the session from everything.
      setSelectedTask(task);
      setSelectedGoal(task.goalId ? (goalsQuery.data?.find((g) => g.id === task.goalId) ?? null) : null);
      // A session already in flight gets re-pointed in the store; the local
      // selection above only governs the *next* start.
      retarget(task.id, task.goalId);
    },
    [attachToEntry, goalsQuery.data, hasServerSession, patchServerSession, pickerTarget, retarget],
  );

  const handlePickGoal = useCallback(
    (goal: Goal) => {
      const target = pickerTarget;
      userSelectedRef.current = true;
      if (target?.kind === "entry") {
        void attachToEntry(target.entry, { goalId: goal.id });
        return;
      }
      // A task only makes sense under its own goal, so switching goals drops
      // a task that belongs to a different one — but keeps it when it's a
      // task of the goal just picked, which is what makes the two slots feel
      // independent rather than one resetting the other.
      const keptTask = activeTask && activeTask.goalId === goal.id ? activeTask : null;
      if (hasServerSession) {
        void patchServerSession(
          {
            goalId: goal.id,
            taskId: keptTask?.id ?? null,
            // The session's denormalised name is what a server-side stop
            // writes into the TimeEntry, so a name left over from a task
            // we're detaching would file this session under something it is
            // no longer tracking. `undefined` means "leave it alone" (see
            // ActiveTimerAttributionInput), which is what protects a name the
            // user actually chose — a Coach session named "gym" keeps that
            // name when a goal is added to it.
            taskName: keptTask
              ? keptTask.title
              : effectiveTaskId !== null || sessionName === null
                ? goal.title
                : undefined,
          },
          "Couldn't attach that goal. Your timer is still running.",
          () => handlePickGoal(goal),
        );
        return;
      }
      setSelectedGoal(goal);
      setSelectedTask(keptTask);
      retarget(keptTask?.id, goal.id);
      // Deliberately does NOT close the sheet (contrast handlePickTask,
      // which does via `setPickerTarget(null)` above it). Picking a goal is
      // step one of the cascading flow TrackingPicker now offers: if the
      // goal has tasks of its own, the sheet stays open showing them as a
      // scoped quick-pick, and TrackingPicker itself decides when to call
      // `onClose` — immediately if the goal has no tasks to narrow to,
      // otherwise once the user picks one of them or backs out.
    },
    [activeTask, attachToEntry, effectiveTaskId, hasServerSession, patchServerSession, pickerTarget, retarget, sessionName],
  );

  /** "Just track time" — clears both slots, pre-start or mid-run. */
  const handlePickNone = useCallback(() => {
    setPickerTarget(null);
    userSelectedRef.current = true;
    setSelectedTask(null);
    setSelectedGoal(null);
    if (hasServerSession) {
      void patchServerSession(
        { taskId: null, goalId: null },
        "Couldn't clear that attribution. Your timer is still running.",
        () => handlePickNone(),
      );
      return;
    }
    retarget(undefined, undefined);
  }, [hasServerSession, patchServerSession, retarget]);

  /**
   * "No task" — drops the task and keeps the goal. The other half of making
   * the two slots independent: without it the only way to remove a task was
   * to clear the attribution entirely and re-pick the goal.
   */
  const handleClearTask = useCallback(() => {
    setPickerTarget(null);
    userSelectedRef.current = true;
    setSelectedTask(null);
    if (hasServerSession) {
      void patchServerSession(
        {
          taskId: null,
          // Same reasoning as handlePickGoal: the leftover name would file
          // this session under the task it no longer has.
          taskName: goalTitle ?? null,
        },
        "Couldn't clear that task. Your timer is still running.",
        () => handleClearTask(),
      );
      return;
    }
    // Reads the store rather than `selectedGoal`, which is null for a session
    // that was already running when this screen mounted.
    retarget(undefined, useTimerStore.getState().goalId ?? selectedGoal?.id ?? selectedTask?.goalId);
  }, [goalTitle, hasServerSession, patchServerSession, retarget, selectedGoal, selectedTask]);

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

      // Clean up the empty cross-device row this screen has been ignoring
      // (see `dormantServerSession`), now that the user has actually started
      // something. Deliberately here and not on sight: merely LOOKING at the
      // Timer screen shouldn't write to the server. Best-effort and silent —
      // it holds no time and no attribution, so there is nothing to report
      // and nothing to lose if it fails; the row stays dormant either way and
      // keeps being ignored. Left in place it would go on 409-ing every
      // start from the Coach and web.
      if (dormantServerSession !== null) {
        void apiClient.timerSession
          .discard()
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          })
          .catch(() => {});
      }
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
      setDailyCapWarning({
        maxTasksPerDay,
        todaysEntryCount,
        onStartAnyway: beginSession,
      });
      return;
    }

    beginSession();
  }, [analytics, dormantServerSession, hasServerSession, recentQuery.data, selectedGoal, selectedTask, start, user]);

  const handlePause = useCallback(() => {
    if (hasServerSession) {
      void apiClient.timerSession
        .pause()
        .then(() => {
          hapticLight();
          analytics.track({ name: "timerPaused", payload: { taskId: serverSession?.taskId ?? undefined } });
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
        })
        .catch((err) => {
          console.error(err);
          notify(getErrorMessage(err, "Couldn't pause. Please check your connection and try again."), "error", {
            action: { label: "Retry", onPress: () => handlePause() },
          });
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
        .catch((err) => {
          console.error(err);
          notify(getErrorMessage(err, "Couldn't resume. Please check your connection and try again."), "error", {
            action: { label: "Retry", onPress: () => handleResume() },
          });
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
            durationSeconds: Math.round((firstFinite(res.data.elapsedMs) ?? 0) / 1000),
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
      } catch (err) {
        // ActiveTimerService#stop deletes the session row and writes the
        // TimeEntry inside one transaction (dw-time-api's active-timer.service.ts)
        // — a request that fails here, for any reason, has left the session
        // exactly as it was. There is nothing local to protect and nothing
        // destructive about a plain retry, unlike the local-store path below.
        console.error(err);
        serverStopRetryRef.current = submitServerStop;
        setServerStopError(null);
        setServerStopFailure(true);
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
    } catch (err) {
      console.error(err);
      stopping.current = false;
      notify(
        `${formatDuration(durationMinutes)} was tracked but couldn't be prepared for saving. Please add it manually.`,
        "error",
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

    // Minted ONCE and reused by every attempt to persist this session (the
    // first `submit()`, each Retry, and the outbox replay), so the server
    // recognises them as the same create rather than inserting it again.
    const idempotencyKey = genId();

    const submit = async () => {
      await apiClient.timeEntries.create(payload, { idempotencyKey });
      hapticCompletion();
      analytics.track({
        name: "timerStopped",
        payload: { taskId: stoppedTaskId, durationSeconds: elapsedSeconds },
      });
      finalizeLocalStop();
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      if (stoppedGoalId) {
        void queryClient.invalidateQueries({
          queryKey: goalQueries.goalQueries.all,
        });
      }
    };

    // Shared by the first attempt and every Retry: re-derives which dialog to
    // show from whatever error just came back, rather than assuming a retry
    // fails the same way the first attempt did. Discard is the only path that
    // actually clears the store — the store isn't reset until the entry is
    // confirmed saved, durably queued, or explicitly discarded (see
    // `finalizeLocalStop` above), so "Discard" here really does throw the
    // tracked time away rather than just dismissing a dialog.
    const presentSaveFailureDialog = (err: unknown) => {
      console.error(err);
      const runningWord = status === "paused" ? "paused" : "running";

      const retry = () => {
        setSaveFailureBusy(true);
        setSaveFailureError(null);
        stopping.current = true;
        void submit()
          .then(() => setSaveFailureDialog(null))
          .catch((retryErr) => {
            console.error(retryErr);
            setSaveFailureError(getErrorMessage(retryErr, "Still couldn't save. Please try again."));
          })
          .finally(() => {
            stopping.current = false;
            setSaveFailureBusy(false);
          });
      };

      const discard = () => {
        finalizeLocalStop();
        setSaveFailureDialog(null);
      };

      if (isPlanLimitError(err)) {
        const capWord = Number.isFinite(user?.limits?.maxTasksPerDay)
          ? `today's free-plan limit of ${user?.limits?.maxTasksPerDay} tracked sessions`
          : "today's plan limit for tracked sessions";
        setSaveFailureError(null);
        setSaveFailureDialog({
          title: "Can't save this session yet",
          description: `You've reached ${capWord}. ${formatDuration(durationMinutes)} against "${label}" is still safe — your timer is still ${runningWord}, nothing is lost. Upgrade to save it now, or it'll be available to save after midnight.`,
          onRetry: retry,
          onDiscard: discard,
        });
        return;
      }

      setSaveFailureError(null);
      setSaveFailureDialog({
        title: "Couldn't save time entry",
        description: `Your timer is still ${runningWord}. ${formatDuration(durationMinutes)} against "${label}" hasn't been saved yet.`,
        onRetry: retry,
        onDiscard: discard,
      });
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
          // The SAME key the live attempt above already sent, not a fresh one.
          idempotencyKey,
          createdAt: Date.now(),
          retries: 0,
        });
        // Durably queued — safe to reset now, the sync engine owns delivery
        // from here. A plain informational Alert (no buttons, nothing for
        // the user to decide) doesn't need the OS dialog treatment — routed
        // through the toast queue instead, same as every other "queued
        // offline" confirmation in the app (goals.tsx, tasks.tsx, notes.tsx,
        // journal.tsx, useQuickAdd.ts all use `notify(..., "offline")` for
        // this exact situation). This one previously used `Alert.alert`
        // because it predates ToastHost/toast-store.ts; nothing about it
        // required the modal treatment.
        finalizeLocalStop();
        notify(
          `${formatDuration(durationMinutes)} saved offline — will sync the next time you're online.`,
          "offline",
        );
        return;
      }

      // The server responded and refused. Replaying a payload it has already
      // rejected won't always help, but the store stays intact either way so
      // there's always something real to retry against.
      presentSaveFailureDialog(err);
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
  const pickerSlot = pickerTarget?.kind === "session" ? pickerTarget.slot : undefined;
  // Both ids, separately: the sheet check-marks the goal AND the task, and
  // uses the goal to lead the task list with that goal's own tasks.
  const pickerSelectedGoalId =
    pickerTarget?.kind === "entry" ? (pickerTarget.entry.goalId ?? null) : slotGoalId;
  const pickerSelectedTaskId =
    pickerTarget?.kind === "entry" ? (pickerTarget.entry.taskId ?? null) : slotTaskId;

  /**
   * Applies the live schedule block's goal (and its task, when it names one)
   * in a single tap from the attribution row. Routed through the same
   * handlers a picker tap uses, so it is one code path to the server and one
   * to the local store — including `userSelectedRef`, which is what stops the
   * auto-select effect from second-guessing the choice afterwards.
   */
  const applyScheduledTarget = () => {
    if (!scheduledTarget) return;
    if (scheduledTarget.task) {
      handlePickTask(scheduledTarget.task);
      return;
    }
    handlePickGoal(scheduledTarget.goal);
    setPickerTarget(null);
  };

  const statusMeta = STATUS_META[effectiveStatus];
  const ringSize = Math.max(
    150,
    Math.min(
      MAX_RING_SIZE,
      width - RING_HORIZONTAL_INSET,
      height * RING_HEIGHT_FRACTION,
    ),
  );

  // Fixed wall-clock start beats a second copy of the elapsed count already
  // filling the middle of the ring.
  const ringCaption =
    effectiveStatus === "running" && effectiveStartedAt !== null
      ? `Started ${new Date(effectiveStartedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : effectiveStatus === "paused"
        ? "Paused"
        : "Elapsed";

  // The whole hero, hoisted into one element so it can be handed to the
  // session list as its header — see `SessionHistory`'s `ListHeaderComponent`
  // doc for why this screen has to have exactly one scroll container. The
  // no-entries branches below reuse the identical element inside a plain
  // ScrollView, so the screen looks and scrolls the same however much
  // history exists.
  const hero = (
    <>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Focus</Text>
        <Text style={styles.headerTitle}>Time Tracker</Text>
      </View>

      <View
        style={[
          styles.timerCard,
          // A running/paused session gets a hairline of its own goal's color
          // and steps up to the next elevation on the shadow ramp (see
          // theme/foundation.ts's "THE RAMP" note: `raised` is for a surface
          // that's actively floating over the rest of the screen, which is
          // exactly what the hero card is while a session is live). Idle
          // stays on the neutral border and the plain `card` elevation —
          // this is a state cue, not decoration, so it only appears when
          // there's a state to cue.
          effectiveStatus !== "idle" && activeColor
            ? { borderColor: activeColor, ...shadows.raised }
            : effectiveStatus !== "idle"
              ? shadows.raised
              : null,
        ]}
      >
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

        {/* Tracking-scoped voice control. Seated right under the ring — next
            to the elapsed time it reads, not floating below the whole card
            the way it used to — because saying "start tracking X" is meant
            to read as a second on-ramp into the SAME session TimerControls
            starts below, not a separate feature bolted onto the bottom of
            the screen. It stays visually subordinate to that transport row
            on purpose: the orb renders at `minTouchTarget` (44pt — see
            TrackerVoiceButton's own styles), smaller than both TimerControls'
            88pt primary and its 56pt Stop, so Start/Pause/Stop still reads as
            the card's one primary action even though the mic sits above it.
            Self-contained — it reads the timer store and the goal/task lists
            itself — except for stopping, which is handed back to this
            screen's own handler so there stays exactly one path that writes
            a TimeEntry (or, now, stops a server session). `serverSessionActive`
            closes the same double-session gap through this entry point:
            without it, saying "start tracking X" while a server session is
            already running would create a second, purely local one via the
            voice path, the same bug this screen's own Start button is
            guarded against above. */}
        <TrackerVoiceButton onStopSession={() => void handleStop()} serverSessionActive={hasServerSession} />

        <TrackingTarget
          goalLabel={goalTitle}
          goalSublabel={goalCategory}
          taskLabel={taskTitle}
          sessionName={sessionName}
          accentColor={activeColor}
          goalUnresolved={goalUnresolved}
          taskUnresolved={taskUnresolved}
          running={effectiveStatus !== "idle"}
          suggestion={
            scheduledTarget
              ? {
                  blockTitle: scheduledTarget.block.title,
                  goalTitle: scheduledTarget.goal.title,
                  taskTitle: scheduledTarget.task?.title ?? null,
                  color: scheduledTarget.goal.color,
                }
              : null
          }
          onApplySuggestion={applyScheduledTarget}
          onPressGoal={() => setPickerTarget({ kind: "session", slot: "goal" })}
          onPressTask={() => setPickerTarget({ kind: "session", slot: "task" })}
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
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {recentQuery.isPending ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {hero}
          <View style={styles.skeletonArea}>
            {Array.from({ length: RECENT_SKELETON_ROWS }).map((_, index) => (
              <SkeletonListItem key={index} showLeading={false} />
            ))}
          </View>
        </ScrollView>
      ) : recentQuery.isError && !recentQuery.data ? (
        // `isError && !data`, matching goals.tsx/tasks.tsx/schedule.tsx's own
        // guard — without it a failed background refetch (e.g. pull-to-
        // refresh while offline) would replace an already-loaded session
        // list with a hard error instead of just leaving it on screen.
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {hero}
          <QueryErrorState
            error={recentQuery.error}
            message="Couldn't load recent entries."
            onRetry={() => void recentQuery.refetch()}
          />
        </ScrollView>
      ) : !recentQuery.data || recentQuery.data.length === 0 ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {hero}
          <EmptyState
            message="No sessions yet"
            description="Just press start — logged sessions land here. Attaching a goal is optional."
          />
        </ScrollView>
      ) : (
        <SessionHistory
          ListHeaderComponent={hero}
          entries={recentQuery.data}
          refreshing={recentQuery.isFetching && !recentQuery.isPending}
          onRefresh={() => void recentQuery.refetch()}
          onAttachGoal={openAttachPicker}
          attachingEntryId={attachingEntryId}
        />
      )}

      <TrackingPicker
        visible={pickerTarget !== null}
        tasks={tasksQuery.data ?? []}
        goals={goalsQuery.data ?? []}
        selectedGoalId={pickerSelectedGoalId}
        selectedTaskId={pickerSelectedTaskId}
        mode={pickerMode}
        slot={pickerSlot}
        onPickTask={handlePickTask}
        onPickGoal={handlePickGoal}
        onPickNone={handlePickNone}
        onClearTask={handleClearTask}
        onClose={() => setPickerTarget(null)}
      />

      <ConfirmDialog
        visible={dailyCapWarning !== null}
        title="You're at today's tracking limit"
        description={
          dailyCapWarning
            ? `Your plan saves up to ${dailyCapWarning.maxTasksPerDay} tracked sessions a day, and you've already logged ${dailyCapWarning.todaysEntryCount}. You can still start this timer, but stopping it won't save until you upgrade or a new day begins.`
            : undefined
        }
        confirmLabel="Start Anyway"
        cancelLabel="Cancel"
        onConfirm={() => {
          dailyCapWarning?.onStartAnyway();
          setDailyCapWarning(null);
        }}
        onCancel={() => setDailyCapWarning(null)}
      />

      <ConfirmDialog
        visible={serverStopFailure}
        title="Couldn't save that session"
        description="It's still safe — the session is still active on the server. Check your connection and try again."
        confirmLabel="Retry"
        cancelLabel="Keep Tracking"
        busy={serverStopBusy}
        error={serverStopError}
        onConfirm={() => {
          const retry = serverStopRetryRef.current;
          if (!retry) return;
          setServerStopBusy(true);
          setServerStopError(null);
          stopping.current = true;
          void retry()
            .then(() => setServerStopFailure(false))
            .catch((err) => {
              console.error(err);
              setServerStopError(
                getErrorMessage(err, "Still couldn't save. The session is still active on the server — try again shortly."),
              );
            })
            .finally(() => {
              stopping.current = false;
              setServerStopBusy(false);
            });
        }}
        onCancel={() => setServerStopFailure(false)}
      />

      <ConfirmDialog
        visible={saveFailureDialog !== null}
        title={saveFailureDialog?.title ?? ""}
        description={saveFailureDialog?.description}
        confirmLabel="Retry"
        cancelLabel="Keep Tracking"
        tertiaryLabel="Discard"
        busy={saveFailureBusy}
        error={saveFailureError}
        onConfirm={() => saveFailureDialog?.onRetry()}
        onCancel={() => setSaveFailureDialog(null)}
        onTertiary={() => saveFailureDialog?.onDiscard()}
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
    opacity.value = withRepeat(
      withTiming(0.3, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [pulse, reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[styles.statusDot, { backgroundColor: color }, animatedStyle]}
    />
  );
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
    // "A control seated ON a surface" — theme/foundation.ts's own rubric for
    // when to reach for `shadows.subtle` — is exactly what this pill is
    // sitting on the card. It had no elevation of its own before, so it read
    // as a flat sticker rather than a chip resting on the hero.
    ...shadows.subtle,
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
  /**
   * Used by the three no-history branches, which scroll a plain ScrollView
   * rather than the session list. `paddingBottom` clears the tab bar: its
   * centre control is a circle lifted out of the row (see
   * components/voice/VoiceTabButton.tsx), so the bar occludes more than its
   * own height and content ending flush at the viewport bottom would sit
   * underneath it.
   */
  scrollContent: {
    paddingBottom: spacing.huge,
  },
  skeletonArea: {
    paddingHorizontal: spacing.xl,
  },
});
