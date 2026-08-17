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
import { AppState, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
  hasResponse,
  namedTarget,
  resolveSpokenTarget,
  toActiveTimerSession,
  updateTimeEntrySchema,
  type ActiveTimerClient,
  type ActiveTimerSession,
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
import { useScreenView } from "@/hooks/useScreenView";
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
  applyOptimisticPause,
  applyOptimisticResume,
  canAttemptAutoSelect,
  cleanLabel,
  describeStartConflict,
  firstFinite,
  isDormantLocalSession,
  isDormantServerSession,
  isLiveStoreIdleForAutoSelect,
  NOTIFICATION_DORMANT_TOLERANCE_MS,
  readStartConflict,
  resolveEffectiveTimer,
  resolveRefiledEntryName,
  resolveRetargetedSessionName,
  resolveScheduledTarget,
} from "@/lib/timer-attribution";
import { getElapsedMs, useTimerStore, type TimerStatus } from "@/lib/timer-store";
import { useTimerReminders } from "@/lib/useTimerReminders";
import { useAuth } from "@/providers/auth-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";
import { RUNNING_SYNC_INTERVAL_MS, syncWidgets } from "@/widgets/widget-sync";

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

/**
 * Tags a session this device starts with which device started it. Purely
 * informational — it is what lets the OTHER client's takeover prompt say
 * "has been running on an iPhone" instead of "on another device" (see the
 * API's StartTimerSessionDto). The API accepts exactly these four values.
 */
const TIMER_CLIENT: ActiveTimerClient =
  Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown";

/** What a start is being attempted against — carried through the conflict dialog so "Stop & Start Fresh" retries the SAME target. */
interface StartTarget {
  taskId?: string;
  goalId?: string;
  taskName: string | null;
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

  // The "a timer is already running somewhere else" dialog — the 409 the API
  // answers a second start with (see ActiveTimerService#start, whose whole
  // reason for 409-ing instead of silently taking over is that the takeover
  // would destroy however long the other device had been tracking). The 409
  // body carries the full session, so this needs no extra fetch to describe
  // what is blocking the start.
  const [startConflict, setStartConflict] = useState<{ session: ActiveTimerSession; target: StartTarget } | null>(
    null,
  );
  const [startConflictBusy, setStartConflictBusy] = useState(false);
  const [startConflictError, setStartConflictError] = useState<string | null>(null);

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

  useScreenView("timer");

  useFocusEffect(
    useCallback(() => {
      // Tabs stay mounted in this app (see TrackerVoiceButton.tsx's header),
      // so the query's own on-mount fetch only ever catches the first time
      // this tab is opened. Re-checking on every focus is what catches
      // "started tracking from the Coach screen, then switched to this tab".
      void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
    }, []),
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
  //
  // The merge itself lives in timer-attribution.ts so <GlobalTrackingBanner/>
  // can perform the IDENTICAL one, rather than reading the local store alone
  // the way it used to (which is why a timer started on the web app never
  // appeared anywhere in this app except this one screen).
  const effective = resolveEffectiveTimer(serverSession, {
    status,
    startedAt,
    pausedElapsedMs,
    taskId: timerTaskId,
    goalId: timerGoalId,
  });
  const effectiveStatus: TimerStatus = effective.status;
  const effectiveStartedAt = effective.startedAt;
  const effectivePausedElapsedMs = effective.pausedElapsedMs;
  const effectiveTaskId = effective.taskId;
  const effectiveGoalId = effective.goalId;

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

  /** Set once a start this screen issued has been accepted by the server — see the reconciliation effect below for what that fact is used for. */
  const publishedServerSessionRef = useRef(false);
  const lastServerSessionIdRef = useRef<string | null>(null);

  /**
   * Puts the local store and this screen's pre-start selection back to idle.
   *
   * Shared by every path that ends a session — the local save, a server-side
   * stop, and the reconciliation effect below — because the local store is
   * now a MIRROR of the server session whenever one exists (Start writes to
   * both; see `publishSessionStart`). A mirror left saying "running" after
   * the thing it mirrors has gone is exactly the phantom session this screen
   * has to stop producing.
   *
   * `userSelectedRef` resets here too: a stopped session is a genuinely
   * fresh idle period, not a continuation of the one the user picked
   * attribution for — without this, auto-select-on-open's latch stays
   * permanently true for the rest of the app's mount lifetime the moment a
   * user interacts with the picker even once, so it would never again
   * auto-fill the next schedule block that goes live.
   */
  const resetLocalSessionState = useCallback(() => {
    publishedServerSessionRef.current = false;
    stop();
    setSelectedTask(null);
    setSelectedGoal(null);
    userSelectedRef.current = false;
  }, [stop]);

  /**
   * Reconciles the local store when the session it was mirroring ends
   * somewhere else — stopped on the web app, on another phone, or by the
   * Coach.
   *
   * Both guards are load-bearing. `publishedServerSessionRef` limits this to
   * a local session THIS screen mirrored onto the server, and `previousId`
   * requires that the mirror was actually OBSERVED before it vanished. A
   * session started offline (the start POST failed, so there is no server
   * row and never was one) satisfies neither, and its elapsed time — which
   * is real, unsaved, and only in this app's memory — is left strictly
   * alone.
   */
  useEffect(() => {
    const previousId = lastServerSessionIdRef.current;
    const currentId = serverSession?.id ?? null;
    lastServerSessionIdRef.current = currentId;
    if (previousId === null || currentId !== null) return;
    if (!publishedServerSessionRef.current) return;
    resetLocalSessionState();
  }, [resetLocalSessionState, serverSession]);

  /**
   * FEATURE: auto-select-on-open — defaults the tracker to whatever schedule
   * block is live right now, matching `app/(app)/index.tsx`'s "FOCUS NOW"
   * card.
   *
   * Guarded three ways, all required (see `canAttemptAutoSelect` in
   * timer-attribution.ts for the extracted, unit-tested version of this
   * first check — including why it deliberately does NOT gate on the
   * screen's `autostart` deep-link param the way an earlier version did):
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
      !canAttemptAutoSelect({
        effectiveStatus,
        localDormant,
        userSelected: userSelectedRef.current,
        hasSelectedTask: selectedTask !== null,
        hasSelectedGoal: selectedGoal !== null,
      })
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
    // still read as stale "idle" here — and, just as importantly, so does a
    // deep-link effect (autostart=1/active/spoken, declared above this one)
    // calling `start()` earlier in this same effect flush. `retarget()`'s
    // own idle check can't catch either case — it protects the opposite
    // direction (a truly idle store).
    if (!isLiveStoreIdleForAutoSelect(useTimerStore.getState(), hasServerSession)) return;

    // BOTH slots, not one or the other: the goal is what the block is for,
    // and the task (when the block names one) narrows it. Setting the goal
    // even in the task case is what lets the user drop the task later and
    // still be tracking against something.
    setSelectedGoal(scheduled.goal);
    setSelectedTask(scheduled.task);
    retarget(scheduled.task?.id, scheduled.goal.id);
  }, [
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
  // treats dormancy as idle regardless of what the screen shows — using
  // NOTIFICATION_DORMANT_TOLERANCE_MS rather than the stricter default
  // (localDormant/dormantServerSession above), since a session with a few
  // real seconds logged but nothing attached still displays as an identical
  // "0m tracked so far" in a notification that only ever shows whole
  // minutes. Checked against both flavours since either can be under a
  // minute even when neither is dormant enough to trip the strict cutoff
  // that keeps hasServerSession/effectiveStatus themselves honest.
  const suppressDormantNotification = hasServerSession
    ? isDormantServerSession(rawServerSession, NOTIFICATION_DORMANT_TOLERANCE_MS)
    : isDormantLocalSession(
        { status, pausedElapsedMs, taskId: timerTaskId, goalId: timerGoalId },
        NOTIFICATION_DORMANT_TOLERANCE_MS,
      );
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

  // Pokes the home-screen widget to redraw on every start/pause/resume/stop,
  // the same way the shade notification and reminders above react to
  // `effectiveStatus` rather than the raw local store.
  //
  // `app/(app)/_layout.tsx` already does this for `useTimerStore`'s own
  // transitions (mount, foreground, and any change to the LOCAL store's
  // status/taskId/goalId) — but handlePause/handleResume above only call the
  // SERVER pause/resume endpoints once a session is mirrored there (which
  // happens within moments of every Start), and never touch the local store
  // for that branch. So a paused-via-server session left the local store
  // still claiming "running" with its original `startedAt`, which is what
  // `_layout.tsx`'s subscription reads AND what widget-data.ts's
  // `loadWidgetTrackingState` used to read verbatim — the widget kept
  // counting straight through a pause instead of freezing, which is what got
  // reported as "the widget doesn't show the bar moving". Keying this effect
  // on `effectiveStatus`/`effectiveStartedAt` instead (the merged view that
  // already prefers the server session, same as resolveEffectiveTimer's
  // other callers) catches that transition too. `syncWidgets()` itself
  // re-reads state rather than trusting a closure over what's already in
  // scope, is a no-op on iOS-without-a-session-change, and swallows its own
  // failures, so firing it here alongside `_layout.tsx`'s own trigger is
  // redundant on a purely local session but harmless.
  //
  // The interval below is the same "redundant on a purely local session but
  // not on a server one" story, for a different bug: firing `syncWidgets()`
  // only on a transition draws the progress bar correctly the instant a
  // session starts/resumes and then never again, so the bar sits frozen
  // while elapsed time (and its fill fraction) keeps moving underneath it —
  // "tracking widget bar doesn't progress on android". `_layout.tsx` now
  // covers this for LOCAL-store transitions; this covers the SERVER-only
  // session case for the same reason the effect above exists — a session
  // that never touches the local store also never fires `_layout.tsx`'s
  // subscription. Started/stopped by this effect re-running on every
  // `effectiveStatus` change rather than tracked imperatively, since this
  // hook (unlike `_layout.tsx`'s) is already keyed on that value.
  useEffect(() => {
    void syncWidgets();
    if (effectiveStatus !== "running") return;
    const id = setInterval(() => void syncWidgets(), RUNNING_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [effectiveStatus, effectiveStartedAt]);

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
      patch: { taskId?: string; taskTitle?: string; goalId?: string; taskName?: string },
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
   * API answers that with a 404.
   *
   * A 404 here does NOT mean the user's pick failed to make sense — it
   * means the server-side session it was going to be applied to is gone.
   * What the user wanted (attach this goal/task) is still achievable, just
   * locally instead: `onGone` is the caller's own local-only application of
   * the identical pick, the same code path taken when `hasServerSession` is
   * false to begin with. Without this, tapping the schedule suggestion's
   * "Use" chip against a session that had just ended looked like the button
   * was simply broken — a dead-end error with no visible effect — when the
   * fix was one call away. The old bare-error behavior also produced a
   * stack of identical failing toasts from one tap once retried, which is
   * why this never offers "Retry" on a 404 specifically.
   */
  const patchServerSession = useCallback(
    async (
      patch: Parameters<typeof apiClient.timerSession.update>[0],
      errorMessage: string,
      retry: () => void,
      onGone: () => void,
    ) => {
      try {
        await apiClient.timerSession.update(patch);
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      } catch (err) {
        console.error(err);
        const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
        if (status === 404) {
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          onGone();
          notify("That timer session had already ended — applied to a fresh one instead.", "success");
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
      // A task implies its goal, so picking one fills BOTH slots. Setting the
      // goal explicitly (rather than leaving it implied by the task) is what
      // lets "No task" later leave a goal still attached instead of silently
      // detaching the session from everything.
      const applyLocally = () => {
        setSelectedTask(task);
        setSelectedGoal(task.goalId ? (goalsQuery.data?.find((g) => g.id === task.goalId) ?? null) : null);
        // A session already in flight gets re-pointed in the store; the local
        // selection above only governs the *next* start.
        retarget(task.id, task.goalId);
      };
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
          applyLocally,
        );
        return;
      }
      applyLocally();
    },
    [attachToEntry, goalsQuery.data, hasServerSession, patchServerSession, pickerTarget, retarget],
  );

  const handlePickGoal = useCallback(
    (goal: Goal) => {
      const target = pickerTarget;
      userSelectedRef.current = true;
      if (target?.kind === "entry") {
        // Re-filing an already-saved entry. If its name is only the title of
        // whatever goal it used to carry, it moves with the goal — that is
        // the sole in-app repair for rows already written with a stale name
        // (see resolveRefiledEntryName); a chosen name is left alone.
        const renamed = resolveRefiledEntryName({
          entryTaskId: target.entry.taskId ?? null,
          entryTaskName: cleanLabel(target.entry.taskName),
          goalTitles: goalsQuery.data?.map((g) => cleanLabel(g.title)) ?? [],
          nextGoalTitle: cleanLabel(goal.title),
        });
        void attachToEntry(target.entry, {
          goalId: goal.id,
          ...(renamed === undefined ? {} : { taskName: renamed }),
        });
        return;
      }
      // A task only makes sense under its own goal, so switching goals drops
      // a task that belongs to a different one — but keeps it when it's a
      // task of the goal just picked, which is what makes the two slots feel
      // independent rather than one resetting the other.
      const keptTask = activeTask && activeTask.goalId === goal.id ? activeTask : null;
      const applyLocally = () => {
        setSelectedGoal(goal);
        setSelectedTask(keptTask);
        retarget(keptTask?.id, goal.id);
      };
      if (hasServerSession) {
        void patchServerSession(
          {
            goalId: goal.id,
            taskId: keptTask?.id ?? null,
            // The session's denormalised name is what a server-side stop
            // writes into the TimeEntry, so a name left over from the target
            // we're detaching would file this session under something it is
            // no longer tracking. The decision (and why a name the user
            // actually chose is left alone instead) lives in
            // resolveRetargetedSessionName, which has the regression test.
            taskName: keptTask
              ? keptTask.title
              : resolveRetargetedSessionName({
                  sessionName,
                  currentTaskTitle: taskTitle,
                  currentGoalTitle: goalTitle,
                  nextName: goal.title,
                }),
          },
          "Couldn't attach that goal. Your timer is still running.",
          () => handlePickGoal(goal),
          applyLocally,
        );
        return;
      }
      applyLocally();
      // Deliberately does NOT close the sheet (contrast handlePickTask,
      // which does via `setPickerTarget(null)` above it). Picking a goal is
      // step one of the cascading flow TrackingPicker now offers: if the
      // goal has tasks of its own, the sheet stays open showing them as a
      // scoped quick-pick, and TrackingPicker itself decides when to call
      // `onClose` — immediately if the goal has no tasks to narrow to,
      // otherwise once the user picks one of them or backs out.
    },
    // `goalTitle`/`taskTitle` are load-bearing here, not lint hygiene: they
    // are compared against `sessionName`, and a callback not recreated when
    // they change would compare two values captured in different renders.
    [
      activeTask,
      attachToEntry,
      goalTitle,
      goalsQuery.data,
      hasServerSession,
      patchServerSession,
      pickerTarget,
      retarget,
      sessionName,
      taskTitle,
    ],
  );

  /** "Just track time" — clears both slots, pre-start or mid-run. */
  const handlePickNone = useCallback(() => {
    setPickerTarget(null);
    userSelectedRef.current = true;
    setSelectedTask(null);
    setSelectedGoal(null);
    if (hasServerSession) {
      void patchServerSession(
        {
          taskId: null,
          goalId: null,
          // Detaching everything has to drop an auto-derived name too, or an
          // explicit "just track time" still saves the entry named after the
          // goal the user just removed. `null` lets the server fall back to
          // its own DEFAULT_TASK_NAME; a name the user chose is left alone.
          taskName: resolveRetargetedSessionName({
            sessionName,
            currentTaskTitle: taskTitle,
            currentGoalTitle: goalTitle,
            nextName: null,
          }),
        },
        "Couldn't clear that attribution. Your timer is still running.",
        () => handlePickNone(),
        () => retarget(undefined, undefined),
      );
      return;
    }
    retarget(undefined, undefined);
  }, [goalTitle, hasServerSession, patchServerSession, retarget, sessionName, taskTitle]);

  /**
   * "No task" — drops the task and keeps the goal. The other half of making
   * the two slots independent: without it the only way to remove a task was
   * to clear the attribution entirely and re-pick the goal.
   */
  const handleClearTask = useCallback(() => {
    setPickerTarget(null);
    userSelectedRef.current = true;
    setSelectedTask(null);
    // Reads the store rather than `selectedGoal`, which is null for a session
    // that was already running when this screen mounted.
    const applyLocally = () =>
      retarget(undefined, useTimerStore.getState().goalId ?? selectedGoal?.id ?? selectedTask?.goalId);
    if (hasServerSession) {
      void patchServerSession(
        {
          taskId: null,
          // Same reasoning as handlePickGoal, through the same helper: the
          // leftover name would file this session under the task it no longer
          // has — but a name the user chose has to survive this too, which
          // the unconditional `goalTitle ?? null` this replaced did not do.
          taskName: resolveRetargetedSessionName({
            sessionName,
            currentTaskTitle: taskTitle,
            currentGoalTitle: goalTitle,
            nextName: goalTitle,
          }),
        },
        "Couldn't clear that task. Your timer is still running.",
        () => handleClearTask(),
        applyLocally,
      );
      return;
    }
    applyLocally();
  }, [
    goalTitle,
    hasServerSession,
    patchServerSession,
    retarget,
    selectedGoal,
    selectedTask,
    sessionName,
    taskTitle,
  ]);

  /**
   * The bare `POST /timer/session`. Separated from the error handling around
   * it because the conflict dialog's "Stop & Start Fresh" has to re-issue
   * exactly this request with `takeOver: true` once the user has decided.
   */
  const postServerSessionStart = useCallback(async (target: StartTarget, takeOver: boolean) => {
    await apiClient.timerSession.start({
      taskId: target.taskId ?? null,
      goalId: target.goalId ?? null,
      taskName: target.taskName,
      client: TIMER_CLIENT,
      takeOver,
    });
    publishedServerSessionRef.current = true;
    // The local session this row was created for can end while the request
    // is in flight — the request has up to 20s to time out (see the shared
    // client's REQUEST_TIMEOUT_MS) and the Stop button is live throughout.
    // A row outliving the session it mirrors would 409 the next start, so
    // clear it rather than leave it behind. Every caller starts the local
    // session BEFORE awaiting this, which is what makes an idle store here
    // mean "ended", not "not begun yet".
    if (useTimerStore.getState().status === "idle") {
      publishedServerSessionRef.current = false;
      void apiClient.timerSession.discard().catch(() => {});
    }
    void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
  }, []);

  /**
   * Mirrors a just-started local session onto `/timer/session`, so it is
   * visible — and stoppable — from the web app, the Coach and any other
   * device. This is the half of "it should be synced between the web and the
   * mobile" that was missing: this screen READ the cross-device session but
   * never WROTE one, so a timer started on the phone existed nowhere else.
   *
   * Optimistic, exactly like web's own `start()`: the local store has
   * already flipped to running by the time this fires, so the button feels
   * instant and a session started with no connection still runs locally (and
   * still saves, via handleStop's outbox path) — it simply isn't visible
   * elsewhere until connectivity returns.
   */
  const publishSessionStart = useCallback(
    async (target: StartTarget, takeOver: boolean) => {
      try {
        await postServerSessionStart(target, takeOver);
      } catch (err) {
        console.error(err);
        const conflict = readStartConflict(err);
        if (!conflict) {
          // Not a conflict: offline, a timeout, or the plan's daily-entry
          // cap. The local session is real regardless — it keeps running
          // here and stopping it takes handleStop's local path. Deliberately
          // silent: a toast on every offline start would punish the one flow
          // this app most needs to work without a connection, and the cap is
          // already surfaced by the pre-start warning and again on save.
          return;
        }
        // A row carrying nothing — no time, no attribution — is not a
        // session the user could recognise, so replacing it needs no prompt;
        // this is the same judgement `isDormantServerSession` already
        // encodes for what this screen renders. Same for a 409 whose body
        // carries no session at all (the row can go away between the failed
        // insert and the API's re-read): there is nothing to show and
        // nothing to lose.
        if (conflict.session === null || isDormantServerSession(conflict.session)) {
          try {
            await postServerSessionStart(target, true);
          } catch (retryErr) {
            console.error(retryErr);
          }
          return;
        }
        // A real session, running somewhere else. Roll the optimistic local
        // start back — the server refused it, so leaving a second running
        // timer on this screen would be a lie — and hand the choice to the
        // user.
        resetLocalSessionState();
        setStartConflictError(null);
        setStartConflict({ session: conflict.session, target });
      }
    },
    [postServerSessionStart, resetLocalSessionState],
  );

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
      const target: StartTarget = {
        taskId: selectedTask?.id,
        goalId: selectedTask?.goalId ?? selectedGoal?.id,
        taskName: selectedTask?.title ?? selectedGoal?.title ?? null,
      };
      start(target.taskId, target.goalId);
      hapticLight();
      analytics.track({ name: "timerStarted", payload: { taskId: target.taskId } });

      // `takeOver` when an empty cross-device row this screen has been
      // ignoring (see `dormantServerSession`) is already known to be sitting
      // there. It holds no time and no attribution, so replacing it in the
      // same request is strictly better than the fire-and-forget discard
      // this used to do, which raced the very start it was clearing the way
      // for. Left in place, such a row 409s every start from here, the Coach
      // and web alike.
      void publishSessionStart(target, dormantServerSession !== null);
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
  }, [
    analytics,
    dormantServerSession,
    hasServerSession,
    publishSessionStart,
    recentQuery.data,
    selectedGoal,
    selectedTask,
    start,
    user,
  ]);

  /**
   * "Resume Here" — adopt the session that blocked the start instead of
   * replacing it, which is what makes a timer left running on the web app
   * something the user can actually take over from the phone.
   *
   * Nothing local is created: once the dialog closes, the polled server
   * session IS this screen's session (see `resolveEffectiveTimer`), so the
   * ring, the shade notification and Pause/Stop all point at it. A PAUSED
   * session is resumed first — the user pressed Start, so leaving it paused
   * would answer that press with a stopped clock. A RUNNING one needs no
   * request at all.
   */
  const handleResumeConflictingSession = useCallback(() => {
    const conflict = startConflict;
    if (!conflict) return;
    setStartConflictBusy(true);
    setStartConflictError(null);
    const adopt =
      conflict.session.status === "RUNNING"
        ? Promise.resolve()
        : apiClient.timerSession.resume().then(() => undefined);
    void adopt
      .then(() => {
        setStartConflict(null);
        hapticLight();
      })
      .catch((err) => {
        console.error(err);
        setStartConflictError(getErrorMessage(err, "Couldn't pick that session up. Please try again."));
      })
      .finally(() => {
        setStartConflictBusy(false);
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      });
  }, [startConflict]);

  /**
   * "Stop & Start Fresh" — end the other device's session, keeping its time,
   * then start the one the user asked for.
   *
   * Deliberately a real `stop()` and not the bare `takeOver: true` the API
   * also offers: takeOver DISCARDS the session it replaces with no TimeEntry
   * written (StartTimerSessionDto says so explicitly), which would silently
   * destroy however long the other device had been tracking — the exact
   * outcome the 409 exists to prevent, and not what a button labelled "stop
   * it" means. Web's equivalent choice also writes the outgoing session's
   * entry before switching; it just does that client-side, because on web
   * the local store rather than the server holds that elapsed time.
   *
   * The follow-up start still passes `takeOver: true`: the stop above
   * cleared the row, but another device could have claimed it in the gap,
   * and this is the one branch where the user has already said "replace
   * whatever is there".
   */
  const handleReplaceConflictingSession = useCallback(() => {
    const conflict = startConflict;
    if (!conflict) return;
    setStartConflictBusy(true);
    setStartConflictError(null);
    void (async () => {
      let startedLocally = false;
      try {
        await apiClient.timerSession.stop({});
        // The outgoing session's time is banked as a TimeEntry by the line
        // above, so these two lists are stale from here on whichever way the
        // rest of this goes.
        void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });

        // Local first, then the server row — the same order `beginSession`
        // uses, and required by postServerSessionStart's own "did this
        // session end while I was in flight?" check.
        start(conflict.target.taskId, conflict.target.goalId);
        startedLocally = true;
        await postServerSessionStart(conflict.target, true);

        hapticCompletion();
        analytics.track({ name: "timerStarted", payload: { taskId: conflict.target.taskId } });
        setStartConflict(null);
      } catch (err) {
        console.error(err);
        // Roll back a local session started before the failure, so the user
        // isn't left with a timer running silently behind a dialog that says
        // the operation failed.
        if (startedLocally) resetLocalSessionState();
        setStartConflictError(
          getErrorMessage(err, "Couldn't switch sessions. Nothing was lost — please try again."),
        );
      } finally {
        setStartConflictBusy(false);
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      }
    })();
  }, [analytics, postServerSessionStart, resetLocalSessionState, start, startConflict]);

  /**
   * Flips the cached server session to `next` right now, and hands back the
   * exact snapshot to restore if the request behind it fails.
   *
   * The react-query cache is the thing to write, NOT the local zustand store:
   * `resolveEffectiveTimer` ignores the store entirely while a server session
   * exists, so pausing the store here would change nothing on screen while
   * quietly desynchronising the mirror.
   *
   * Returns null when there is nothing to write over, in which case the caller
   * has nothing to roll back either.
   */
  const applyOptimisticSessionState = useCallback(
    (next: (session: ActiveTimerSession, now: Date) => ActiveTimerSession): ActiveTimerSession | null => {
      const key = timerSessionQueries.active().queryKey;
      const previous = queryClient.getQueryData<ActiveTimerSession | null>(key) ?? null;
      if (!previous) return null;
      // A poll GET that was already in flight when the button was pressed
      // would otherwise land a moment later carrying the pre-press status and
      // revert the ring to "running".
      void queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ActiveTimerSession>(key, next(previous, new Date()));
      return previous;
    },
    [],
  );

  /** Undoes `applyOptimisticSessionState`, then re-reads the truth in case the request landed after all. */
  const rollbackOptimisticSessionState = useCallback((previous: ActiveTimerSession | null) => {
    if (!previous) return;
    queryClient.setQueryData<ActiveTimerSession>(timerSessionQueries.active().queryKey, previous);
    // A timed-out request can still have been applied server-side, in which
    // case the rollback above is itself a lie. Only on the failure path, so
    // this costs nothing in the normal case.
    void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
  }, []);

  /**
   * Pause. Optimistic, exactly like `beginSession` above — which is precisely
   * what this was not, and why it was reported as taking "so much time".
   *
   * It used to do nothing at all until `POST /timer/session/pause` came back
   * AND a follow-up `GET /timer/session` (an `invalidateQueries`) came back
   * after it: two full sequential round trips, each preceded by an uncached
   * SecureStore token read, before a single pixel moved. Even the haptic was
   * inside `.then()`, so a press had no response of any kind — and when the
   * POST timed out, the clock kept running for the full 20s request timeout
   * and the user got only a toast.
   *
   * Now the cache flips on the press and the request confirms it. That is one
   * request per pause instead of two: the endpoint already returns the updated
   * session, which the old code threw away and then refetched. No polling
   * cadence changes anywhere — this is strictly fewer requests, not more.
   */
  const handlePause = useCallback(() => {
    if (hasServerSession) {
      hapticLight();
      analytics.track({ name: "timerPaused", payload: { taskId: serverSession?.taskId ?? undefined } });
      const previous = applyOptimisticSessionState(applyOptimisticPause);
      void apiClient.timerSession
        .pause()
        .then((res) => {
          // Reconcile against the server's own arithmetic rather than
          // invalidating: same data, no second round trip.
          const confirmed = toActiveTimerSession(res.data);
          if (confirmed) queryClient.setQueryData(timerSessionQueries.active().queryKey, confirmed);
          // The optimistic write above flips `effectiveStatus` on the press,
          // before this POST resolves — so the effect at the bottom of this
          // file that calls syncWidgets() off `effectiveStatus` has ALREADY
          // fired once (with the pre-POST state) and won't fire again, since
          // the value doesn't change a second time here. Without this, the
          // widget's own independent GET (fetchServerSession in
          // widget-data.ts) can race the 3-round-trip server pause and win,
          // latching the widget on "running" until the next foreground/store
          // change/30-min refresh. Re-sync explicitly once the real state is known.
          void syncWidgets();
        })
        .catch((err) => {
          console.error(err);
          rollbackOptimisticSessionState(previous);
          notify(getErrorMessage(err, "Couldn't pause. Please check your connection and try again."), "error", {
            action: { label: "Retry", onPress: () => handlePause() },
          });
        });
      return;
    }
    pause();
    hapticLight();
    analytics.track({ name: "timerPaused", payload: { taskId: timerTaskId ?? undefined } });
  }, [
    analytics,
    applyOptimisticSessionState,
    hasServerSession,
    pause,
    rollbackOptimisticSessionState,
    serverSession,
    timerTaskId,
  ]);

  /** Resume, optimistic for the same reason and in the same shape as `handlePause`. */
  const handleResume = useCallback(() => {
    if (hasServerSession) {
      hapticLight();
      const previous = applyOptimisticSessionState(applyOptimisticResume);
      void apiClient.timerSession
        .resume()
        .then((res) => {
          const confirmed = toActiveTimerSession(res.data);
          if (confirmed) queryClient.setQueryData(timerSessionQueries.active().queryKey, confirmed);
          // Same widget re-sync as handlePause, same reason — see its comment.
          void syncWidgets();
        })
        .catch((err) => {
          console.error(err);
          rollbackOptimisticSessionState(previous);
          notify(getErrorMessage(err, "Couldn't resume. Please check your connection and try again."), "error", {
            action: { label: "Retry", onPress: () => handleResume() },
          });
        });
      return;
    }
    resume();
    hapticLight();
  }, [applyOptimisticSessionState, hasServerSession, resume, rollbackOptimisticSessionState]);

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
        // The local store mirrors the server session while one exists (Start
        // writes to both), so ending the server session has to end the
        // mirror too. Without this the store stays "running" forever, and
        // the moment `hasServerSession` goes false the screen falls back to
        // it — resurrecting the session the user just stopped.
        resetLocalSessionState();
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

    // Called once the entry is confirmed saved, durably queued offline, or
    // the user explicitly discards it — never merely because the server
    // rejected a save, so a rejected save (the plan-limit cap being the
    // common case) can never take the elapsed time down with it.
    //
    // The server row, if this session ever got one published, goes with it.
    // Best-effort and silent: the TimeEntry is already written by this
    // point, so a failure here leaves a stale row for the dormant-session
    // handling to absorb, not lost time. Only fired when there IS one to
    // clear — a session that never reached the server (offline) has nothing
    // to delete and shouldn't pay for a request to find that out.
    const finalizeLocalStop = () => {
      const hadServerRow = publishedServerSessionRef.current;
      resetLocalSessionState();
      if (hadServerRow) {
        void apiClient.timerSession
          .discard()
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          })
          .catch(() => {});
      }
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
    resetLocalSessionState,
    serverSession,
    startedAt,
    status,
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

      {/* The 409 path. Three genuine choices, so this uses ConfirmDialog's
          tertiary slot rather than two stacked dialogs: Resume Here is the
          primary because the user's session already exists and picking it up
          loses nothing, while Stop & Start Fresh — the one that ends
          something running on another device — sits in the demoted ghost
          slot. Cancel changes nothing at all; the optimistic local start was
          already rolled back when the conflict was detected. */}
      <ConfirmDialog
        visible={startConflict !== null}
        title="A timer is already running"
        description={startConflict ? describeStartConflict(startConflict.session, new Date()) : undefined}
        confirmLabel="Resume Here"
        cancelLabel="Cancel"
        tertiaryLabel="Stop & Start Fresh"
        busy={startConflictBusy}
        error={startConflictError}
        onConfirm={handleResumeConflictingSession}
        onTertiary={handleReplaceConflictingSession}
        onCancel={() => {
          setStartConflict(null);
          setStartConflictError(null);
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
        }}
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
