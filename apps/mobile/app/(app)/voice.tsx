// The open-ended voice assistant, behind the raised mic in the centre of
// the tab bar.
//
// THIS SCREEN ADDS NO INTELLIGENCE. It is a microphone bolted onto the front
// of GoalSlot AI, which already does the hard parts: the model already reads
// the user's real data, already emits ```coach-proposal blocks,
// packages/shared/src/coach/proposals.ts already parses and validates them
// (including remapping the near-miss action names models reach for), and
// POST /coach/proposals/apply already applies a batch. Speech is a new INPUT
// to that pipeline and nothing else — there is no second prompt, no second
// parser, and no second way for the app to mutate a goal.
//
//   speech -> transcript -> apiClient.coach.streamChat (the same call the
//   Coach chat screen makes) -> extractCoachProposals -> the same
//   CoachProposalCard the Coach screen renders -> the user presses Apply ->
//   POST /coach/proposals/apply
//
// WHY A TAB AND NOT A SHEET: a registered route announces itself to a screen
// reader as one tab among tabs, keeps the back gesture behaving normally,
// and leaves the full viewport for the transcript and the confirmation
// cards. See src/components/voice/VoiceTabButton.tsx.
//
// The keyboard path is never more than one tap away — "Type instead" goes to
// the Coach chat screen, which does all of this with a text field. That is
// not a fallback for when voice fails; it is the same feature for people who
// do not or cannot speak to their phone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  createTimeEntrySchema,
  currentCoachWeekScopeKey,
  extractCoachProposals,
  genId,
  getLocalDateString,
  hasResponse,
  NO_TARGET,
  parseVoiceCommand,
  todayKey,
  type ActionableVoiceIntent,
  type AppendNoteIntent,
  type CoachMessageDto,
  type CoachVoiceIntentContext,
  type ConversationTurnSnapshot,
  type CoachProposalAction,
  type CreateTimeEntryInput,
  type JournalEntry,
  type ResolvedTarget,
} from "@goalslot/shared";

import { CoachHistorySheet, type CoachHistorySheetRef } from "@/components/coach/CoachHistorySheet";
import { CoachProposalCard } from "@/components/coach/CoachProposalCard";
import { MicOrb } from "@/components/voice/MicOrb";
import {
  buildNoteCandidates,
  planNoteCommand,
  rejectIfNoteReadOnly,
  type NotePlan,
} from "@/components/voice/note-commands";
import { buildTrackingCandidates, planTrackingCommand, type TrackingPlan } from "@/components/voice/tracking-commands";
import { routeVoiceIntentResponse, shouldEscalateToTier2 } from "@/components/voice/voice-router";
import { CoachBudgetNotice } from "@/components/settings/CoachBudgetNotice";
import { PressableScale } from "@/components/today/PressableScale";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormattedText } from "@/components/ui/FormattedText";
import { Icon } from "@/components/ui/Icon";
import { TypingIndicator } from "@/components/ui/TypingIndicator";
import { useApplyCoachProposals } from "@/hooks/useApplyCoachProposals";
import { useVoiceCapture, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import { apiClient } from "@/lib/api-client";
import { archiveConversation, markLiveConversationReset, recordConversationActivity } from "@/lib/coach-history-store";
import { hapticWarning } from "@/lib/haptics";
import { appendNoteParagraph } from "@/lib/note-content";
import { outbox, queueOfflineEdit } from "@/lib/offline";
import { isPlanLimitError } from "@/lib/plan-limit";
import { coachQueries, goalQueries, journalQueries, noteQueries, taskQueries, timeEntryQueries, timerSessionQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_SESSION_LABEL } from "@/lib/session-label";
import { useTimerStore, type TimerStatus } from "@/lib/timer-store";
import { useAnalytics } from "@/providers/growth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors, iconSize, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const RATE_LIMIT_MESSAGE = "You've used today's 30 Coach messages. It resets in 24 hours — try again later.";

/**
 * Shown instead of a raw network exception whenever a voice command reaches
 * out to GoalSlot AI (Tier 2's /coach/voice-intent classify call, or Tier 3's
 * full Coach chat) and nothing answers at all — no DNS, no server, no
 * response of any kind. Tier 1's local `parseVoiceCommand` matching still
 * works fine while this is on screen; only the tiers that genuinely need the
 * network are affected.
 */
const OFFLINE_MESSAGE =
  "You're offline — voice commands need an internet connection. Try again once you're back online.";

/** Shown at rest so the mic isn't a button with no stated vocabulary. */
const EXAMPLES = [
  "Start tracking time for my deen goal",
  "Add a task to call the bank",
  "Move my study block to 7pm",
  "Add milk to my shopping notes",
  "Add to my journal: had a great workout today",
];

interface Turn {
  /** Stable identity, independent of position — turns are only ever
   * appended or removed by id, never reordered, so an array index would
   * drift under either operation. */
  id: number;
  transcript: string;
  reply: string;
  /** True while the model is still streaming. */
  streaming: boolean;
}

const EMPTY_DISMISSED: ReadonlySet<number> = new Set();

/**
 * A spoken "add this to my X notes" command waiting on the user — a page to
 * pick, or the write itself to confirm. Held outside both `state` (which
 * useVoiceCapture resets to idle the instant `handleCommand` hands off — see
 * VoiceCommandOutcome's 'handoff') and `history` (the Coach thread, which an
 * append command never joins: it is answered by this inline panel, not a
 * reply bubble). Mirrors TrackerVoiceButton's `Pending` union — same reason,
 * same shape.
 */
type NotePending =
  | { kind: "choose"; heardName: string; candidates: readonly ResolvedTarget[]; intent: AppendNoteIntent }
  | { kind: "confirm-append"; target: ResolvedTarget; content: string; message: string };

/**
 * A spoken tracking command waiting on the user — an ambiguous name to pick
 * between, or a logged duration to confirm. Mirrors TrackerVoiceButton's own
 * `Pending` union exactly (same two shapes, same reason: start/stop/pause/
 * resume never pend, only a name resolution or a LOG_TIME write does).
 * Lives outside `state`/`history` for the same reason `notePending` does —
 * see that type's doc comment just above.
 */
type TrackingPending =
  | { kind: "choose"; heardName: string; candidates: readonly ResolvedTarget[]; intent: ActionableVoiceIntent }
  | { kind: "confirm-log"; minutes: number; target: ResolvedTarget | null; message: string };

/**
 * Appends a spoken sentence onto the end of today's journal entry as its own
 * paragraph — never a silent overwrite of whatever the user already wrote
 * today, the same "always append" rule note-commands.ts's own appendToNote
 * follows for pages. Journal content is plain text, not HTML (see
 * journal.tsx's header: no TipTap, no decorative chrome), so this is a
 * blank-line join rather than notes' `appendNoteParagraph` HTML escaping.
 */
function appendJournalParagraph(existing: string, spoken: string): string {
  const trimmed = spoken.trim();
  if (trimmed.length === 0) return existing;
  if (existing.trim().length === 0) return trimmed;
  return `${existing}\n\n${trimmed}`;
}

/**
 * Rebuilds `Turn[]` from the persisted `CoachMessageDto[]` the server holds
 * for this scopeKey — the fix that lets Voice survive an app restart without
 * changing what a live, in-session `history` update looks like (see the
 * seeding effect below: this only ever runs once, before any turn has been
 * appended locally).
 *
 * A USER message pairs with the very next ASSISTANT message; a USER message
 * with nothing following it (the conversation ends mid-turn — the last thing
 * said got no persisted reply) becomes a turn with an empty `reply`, same
 * shape `removeTurn`'s failure path already produces. An ASSISTANT message
 * with no preceding USER message (SYSTEM_NARRATIVE rows are filtered out
 * before this runs, so this shouldn't happen in practice) is dropped rather
 * than rendered with a blank "You said" bubble.
 */
function pairMessagesIntoTurns(messages: readonly CoachMessageDto[]): Turn[] {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const turns: Turn[] = [];
  let pendingUser: CoachMessageDto | null = null;
  let id = 0;

  for (const message of sorted) {
    if (message.role === "USER") {
      if (pendingUser) {
        turns.push({ id: id++, transcript: pendingUser.content, reply: "", streaming: false });
      }
      pendingUser = message;
    } else if (message.role === "ASSISTANT" && pendingUser) {
      turns.push({ id: id++, transcript: pendingUser.content, reply: message.content, streaming: false });
      pendingUser = null;
    }
  }
  if (pendingUser) {
    turns.push({ id: id++, transcript: pendingUser.content, reply: "", streaming: false });
  }
  return turns;
}

/** Flattens the on-screen turns into the shared `{role, content}` shape `archiveConversation` stores. Empty pieces (a turn whose reply never arrived) are dropped rather than archived as blank bubbles. */
function turnsToArchiveSnapshot(turns: readonly Turn[]): ConversationTurnSnapshot[] {
  const snapshot: ConversationTurnSnapshot[] = [];
  for (const turn of turns) {
    if (turn.transcript.trim().length > 0) snapshot.push({ role: "USER", content: turn.transcript });
    if (turn.reply.trim().length > 0) snapshot.push({ role: "ASSISTANT", content: turn.reply });
  }
  return snapshot;
}

export default function VoiceScreen() {
  const router = useRouter();
  const analytics = useAnalytics();
  const { voice } = useCapabilities();
  const scopeKey = useMemo(() => currentCoachWeekScopeKey(), []);
  const { apply } = useApplyCoachProposals();

  // A transcript handed over by the Time Tracker's mic: it heard something
  // that wasn't a tracking command, so rather than telling the user to say
  // it again into a different microphone, it forwards the words here. See
  // src/components/voice/TrackerVoiceButton.tsx's `escalate`.
  const { transcript: forwarded } = useLocalSearchParams<{ transcript?: string }>();

  // Persisted history for this scopeKey — the same query Coach uses
  // (coachQueries.chat(scopeKey)). Read ONLY to seed `history` below on
  // first load, never to keep it in sync afterwards: `history` stays the
  // locally-appended source of truth for the live session exactly as it was
  // before, this just stops it from always starting at `[]` after an app
  // restart.
  const historyQuery = useQuery(coachQueries.chat(scopeKey));
  const seededRef = useRef(false);

  // The pages an "add this to my X notes" command can resolve a spoken name
  // against — same query key notes.tsx and note/[id].tsx use, so this reads
  // whatever they already have cached rather than opening a second copy of
  // the list.
  const notesQuery = useQuery(noteQueries.list());
  const noteCandidates = useMemo(() => buildNoteCandidates(notesQuery.data ?? []), [notesQuery.data]);

  // Tier 1's tracking-command candidates and Tier 2's request context both
  // read from the same two lists TrackerVoiceButton and timer.tsx already
  // load — same query keys, so this reuses whatever is already cached
  // instead of opening a second copy of the user's goals/tasks.
  const goalsQuery = useQuery(goalQueries.list());
  const tasksQuery = useQuery(taskQueries.list());
  const trackingCandidates = useMemo(
    () => buildTrackingCandidates(goalsQuery.data ?? [], tasksQuery.data ?? []),
    [goalsQuery.data, tasksQuery.data],
  );

  // The other possible source of truth for what the timer is doing — see
  // timer.tsx's header for the full "cross-device session" rationale. Unlike
  // that screen this one doesn't poll: it only has to be right at the moment
  // a command is spoken, and `handleMicPress`/the focus effect below refresh
  // it before that moment rather than every few seconds in the background.
  const serverSessionQuery = useQuery(timerSessionQueries.active());
  const serverSession = serverSessionQuery.data ?? null;
  const hasServerSession = serverSession !== null;
  const localTimerStatus = useTimerStore((s) => s.status);
  const timerStart = useTimerStore((s) => s.start);
  const timerRetarget = useTimerStore((s) => s.retarget);
  const timerPause = useTimerStore((s) => s.pause);
  const timerResume = useTimerStore((s) => s.resume);
  const timerStop = useTimerStore((s) => s.stop);
  const effectiveTimerStatus: TimerStatus = hasServerSession
    ? serverSession.status === "RUNNING"
      ? "running"
      : "paused"
    : localTimerStatus;

  // The whole conversation, oldest first, never wiped by a new turn
  // starting — only ever appended to (or, for a turn that failed outright,
  // removed by id). Pressing the mic again while an answer is already on
  // screen used to `setExchange(null)`, which read as "the app forgot what
  // we were just talking about" the instant a follow-up started, even
  // though the follow-up is very often "no, the OTHER Tuesday" rather than
  // a fresh subject. Keeping every turn means a follow-up composes with
  // what is already on screen instead of replacing it.
  const [history, setHistory] = useState<Turn[]>([]);
  // Which proposal cards the user has waved off, keyed by the turn's id —
  // never by array position, which would drift once turns can be removed.
  // A Map, not a single "clear it all" flag: one reply can carry several
  // proposals, and "Not now" on the second one used to wipe the transcript,
  // the assistant's prose and the *other* cards along with it. Keying by
  // turn id also means an earlier turn's dismissals survive a later turn
  // starting, instead of every turn sharing one set indexed against
  // whichever reply happens to be newest.
  const [dismissedProposals, setDismissedProposals] = useState<ReadonlyMap<number, ReadonlySet<number>>>(
    new Map(),
  );
  // The append-to-note question currently on screen, if any — see
  // `NotePending`'s doc comment above.
  const [notePending, setNotePending] = useState<NotePending | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  // The result of a confirmed append. Lands outside `state`/`history` for
  // the same reason `notePending` does: by the time the user presses
  // "Add it", the mic has long since gone back to idle and no Coach turn was
  // ever started for this command.
  const [noteNotice, setNoteNotice] = useState<string | null>(null);
  // The tracking-command question currently on screen, if any — see
  // `TrackingPending`'s doc comment above.
  const [trackingPending, setTrackingPending] = useState<TrackingPending | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  // The result of a start/stop/pause/resume/log run outside the direct mic
  // flow (i.e. from picking a candidate or confirming a logged duration) —
  // same reason `noteNotice` exists: `state` is already back to idle by
  // then. A command that runs directly from `handleCommand` itself instead
  // reports through `state.message` (useVoiceCapture's own 'done'/'failed'
  // handling), exactly like TrackerVoiceButton's own direct mic path.
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);
  const nextTurnId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const historySheetRef = useRef<CoachHistorySheetRef>(null);
  /** Guards the forwarded transcript so a re-focus can't replay the same command. */
  const forwardedRef = useRef<string | null>(null);

  // Seeds `history` from the server exactly once, the first time
  // `historyQuery` settles (success or error) — see the comment on
  // `historyQuery` above for why this never runs again after that. Skipped
  // entirely once a turn has already been appended locally (`history.length
  // > 0` by the time this fires would mean the user started talking before
  // the seed landed), so a fast first command can never be clobbered by a
  // slow-arriving persisted history.
  useEffect(() => {
    if (seededRef.current || historyQuery.isPending) return;
    seededRef.current = true;
    if (history.length > 0) return;
    const data = historyQuery.data;
    if (!data || data.length === 0) return;
    const seeded = pairMessagesIntoTurns(data);
    if (seeded.length === 0) return;
    nextTurnId.current = Math.max(nextTurnId.current, seeded.length);
    setHistory(seeded);
  }, [historyQuery.isPending, historyQuery.data, history.length]);

  const removeTurn = useCallback((turnId: number) => {
    setHistory((current) => current.filter((turn) => turn.id !== turnId));
    setDismissedProposals((current) => {
      if (!current.has(turnId)) return current;
      const next = new Map(current);
      next.delete(turnId);
      return next;
    });
  }, []);

  /**
   * Fetches a page's current content (reusing the same cached
   * `noteQueries.detail` query note/[id].tsx's editor reads/writes), appends
   * the spoken sentence as its own escaped paragraph, and saves it.
   *
   * Never called before the write has been confirmed on screen — see
   * planNoteCommand's header for why this, alone among voice.tsx's writes,
   * always asks first.
   */
  const appendToNote = useCallback(async (target: ResolvedTarget, content: string): Promise<string> => {
    const detail = await queryClient.fetchQuery(noteQueries.detail(target.id)).catch((err: unknown) => {
      // Not cached yet and nothing answered — same "no response at all"
      // signal `hasResponse` reads elsewhere, just for a GET this function
      // has no offline queue for (queueOfflineEdit below only covers the
      // write). A raw axios "Network Error" leaking here would be no
      // friendlier than the fetch exception runCoachTurn used to leak.
      throw new Error(hasResponse(err) ? "Couldn't load that page. Please try again." : OFFLINE_MESSAGE);
    });
    const readOnlyRejection = rejectIfNoteReadOnly(detail.readOnly);
    if (readOnlyRejection !== null) {
      throw new Error(readOnlyRejection.kind === "reject" ? readOnlyRejection.message : "Can't update that page.");
    }

    const newHtml = appendNoteParagraph(detail.note.content, content);
    try {
      await apiClient.notes.update(target.id, { content: newHtml });
      // Matches note/[id].tsx's saveContent / notes.tsx's toggleFavorite:
      // invalidate both the one page's detail (so reopening it shows the
      // new paragraph) and the list (its preview, if it ever grows one).
      void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.detail(target.id) });
      void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.list() });
      return `Added to ${target.name}`;
    } catch (err) {
      // Same offline path note/[id].tsx's saveContent already uses for this
      // exact operation kind — nothing new invented here.
      const queued = await queueOfflineEdit("note-update", { id: target.id, data: { content: newHtml } }, err);
      if (queued) return `Saved offline — will add to ${target.name} once you're back online`;
      throw new Error("Couldn't save that to the page. Please try again.");
    }
  }, []);

  /** A target id Tier 2 already resolved, turned into the `ResolvedTarget` shape `planTrackingCommand`'s `forcedTarget` expects — the display name comes from the same goals/tasks lists just sent as that request's candidates. */
  const resolveTier2Target = useCallback(
    (target: { kind: "goal" | "task"; id: string }): ResolvedTarget => {
      const name =
        target.kind === "goal"
          ? (goalsQuery.data ?? []).find((goal) => goal.id === target.id)?.title
          : (tasksQuery.data ?? []).find((task) => task.id === target.id)?.title;
      // Falling back to the bare id is defensive only — Tier 2 was handed
      // exactly these ids as its candidates, so a miss here would mean the
      // list changed between the request and the response landing.
      return { id: target.id, kind: target.kind, name: name ?? target.id, score: 1, matchedOn: name ?? target.id };
    },
    [goalsQuery.data, tasksQuery.data],
  );

  /**
   * Stops the LOCAL (non-server) session and writes the TimeEntry for it —
   * the one branch `runTrackingAction` below can't just delegate to
   * TrackerVoiceButton's own stop handling, because that always hands off to
   * timer.tsx's `handleStop`, which is tightly coupled to screen-local UI
   * state (retry alerts, plan-limit warnings, an elapsed-time ref fed by
   * TimerRing) this screen has no equivalent surface for. Structurally this
   * is the same "assemble entry, try create, fall back to outbox" shape
   * TrackerVoiceButton's own `logTime` already uses for LOG_TIME — just
   * sourcing its duration from the store's own clock instead of a spoken
   * number.
   */
  const stopAndLogLocalSession = useCallback(async (): Promise<VoiceCommandOutcome> => {
    const { taskId, goalId } = useTimerStore.getState();
    const elapsedMs = timerStop();
    // At least a minute — createTimeEntrySchema's own floor. The timer has
    // already stopped by this point, so silently discarding a shorter
    // session would surprise the user more than rounding it up would.
    const minutes = Math.max(1, Math.round(elapsedMs / 60_000));
    const targetName =
      (goalId ? (goalsQuery.data ?? []).find((goal) => goal.id === goalId)?.title : undefined) ??
      (taskId ? (tasksQuery.data ?? []).find((task) => task.id === taskId)?.title : undefined) ??
      null;

    const payload: CreateTimeEntryInput = createTimeEntrySchema.parse({
      taskName: targetName ?? DEFAULT_SESSION_LABEL,
      ...(taskId ? { taskId, taskTitle: targetName ?? undefined } : {}),
      ...(goalId ? { goalId } : {}),
      duration: minutes,
      date: getLocalDateString(),
    });

    // One key for this stopped session, shared by the live attempt and the
    // queued replay below — see timer.tsx's handleStop for the full
    // reasoning. Short version: a create that times out may well have
    // committed, and `hasResponse` cannot tell that from "never sent", so the
    // replay has to be recognisable to the server as the same create.
    const idempotencyKey = genId();

    try {
      await apiClient.timeEntries.create(payload, { idempotencyKey });
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      if (goalId) void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      return { kind: "done", message: "Stopped and saved" };
    } catch (err) {
      if (!hasResponse(err)) {
        // Offline. Measured-and-then-dropped time is unrecoverable, so it's
        // banked rather than surfaced as a failure — same as TrackerVoiceButton's logTime.
        await outbox.addToOutbox({
          id: genId(),
          kind: "time-entry-create",
          payload,
          idempotencyKey,
          createdAt: Date.now(),
          retries: 0,
        });
        return { kind: "done", message: "Saved offline — will sync when you're back on" };
      }
      return {
        kind: "failed",
        message: isPlanLimitError(err)
          ? "You've reached today's plan limit for tracked sessions. Upgrade or wait for a new day."
          : "Couldn't save that time entry. Please try again.",
      };
    }
  }, [goalsQuery.data, tasksQuery.data, timerStop]);

  /**
   * Runs an immediately-runnable transport change (start/retarget/pause/
   * resume/stop) exactly the way TrackerVoiceButton/timer.tsx already do —
   * against the cross-device server session when one is active
   * (apiClient.timerSession), otherwise against the local zustand store —
   * so a command spoken from this screen behaves identically to the same
   * command spoken from the Time Tracker's own mic or pressed on its own
   * buttons.
   */
  const runTrackingAction = useCallback(
    async (plan: Extract<TrackingPlan, { kind: "run" }>): Promise<VoiceCommandOutcome> => {
      if (hasServerSession) {
        if (plan.action === "start") {
          // Mirrors TrackerVoiceButton's own guard: a server session is
          // already the authoritative one, so a local start here would
          // reproduce the exact double-timer bug that flag exists to avoid.
          return { kind: "failed", message: "A session is already running — open the Time Tracker to control it." };
        }
        try {
          switch (plan.action) {
            case "retarget":
              // Matches timer.tsx's own handlePickTask/handlePickGoal update
              // calls exactly (taskName sent for a task target so the
              // server's own display name updates too; a goal target clears
              // taskId outright rather than leaving a stale one attached).
              await apiClient.timerSession.update(
                plan.target?.kind === "task"
                  ? { taskId: plan.target.id, goalId: null, taskName: plan.target.name }
                  : { goalId: plan.target?.id ?? null, taskId: null },
              );
              break;
            case "pause":
              await apiClient.timerSession.pause();
              break;
            case "resume":
              await apiClient.timerSession.resume();
              break;
            case "stop": {
              const res = await apiClient.timerSession.stop({});
              void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
              if (res.data.timeEntry.goalId) {
                void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
              }
              break;
            }
          }
          void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
          return { kind: "done", message: plan.message };
        } catch {
          return { kind: "failed", message: "Couldn't reach the timer. Check your connection and try again." };
        }
      }

      const goalId = plan.target?.kind === "goal" ? plan.target.id : undefined;
      const taskId = plan.target?.kind === "task" ? plan.target.id : undefined;
      switch (plan.action) {
        case "start":
          timerStart(taskId, goalId);
          return { kind: "done", message: plan.message };
        case "retarget":
          timerRetarget(taskId, goalId);
          return { kind: "done", message: plan.message };
        case "pause":
          timerPause();
          return { kind: "done", message: plan.message };
        case "resume":
          timerResume();
          return { kind: "done", message: plan.message };
        case "stop":
          return stopAndLogLocalSession();
      }
    },
    [hasServerSession, stopAndLogLocalSession, timerPause, timerResume, timerRetarget, timerStart],
  );

  /** Parks a tracking plan as an on-screen question, runs it immediately, or reports it failed outright. */
  const runTrackingPlan = useCallback(
    async (plan: TrackingPlan): Promise<VoiceCommandOutcome> => {
      switch (plan.kind) {
        case "escalate":
          // The only caller filters this out before reaching here; kept so
          // the switch stays exhaustive against TrackingPlan's full union.
          return { kind: "handoff" };
        case "reject":
          return { kind: "failed", message: plan.message };
        case "choose":
          setTrackingPending({ kind: "choose", heardName: plan.heardName, candidates: plan.candidates, intent: plan.intent });
          return { kind: "handoff" };
        case "confirm-log":
          setTrackingPending({ kind: "confirm-log", minutes: plan.minutes, target: plan.target, message: plan.message });
          return { kind: "handoff" };
        case "run":
          setTrackingPending(null);
          return runTrackingAction(plan);
      }
    },
    [runTrackingAction],
  );

  /** Writes a LOG_TIME command's TimeEntry once the user presses "Log it" — identical shape to TrackerVoiceButton's own `logTime`. */
  const logTrackedTime = useCallback(async (minutes: number, target: ResolvedTarget | null): Promise<string> => {
    const payload: CreateTimeEntryInput = createTimeEntrySchema.parse({
      taskName: target?.name ?? DEFAULT_SESSION_LABEL,
      ...(target?.kind === "task" ? { taskId: target.id, taskTitle: target.name } : {}),
      ...(target?.kind === "goal" ? { goalId: target.id } : {}),
      duration: minutes,
      date: getLocalDateString(),
    });

    // Same single-key-per-logical-log rule as every other time-entry create
    // in the app; see timer.tsx's handleStop.
    const idempotencyKey = genId();

    try {
      await apiClient.timeEntries.create(payload, { idempotencyKey });
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      if (target?.kind === "goal") void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      return `Logged ${minutes} min${target === null ? "" : ` to ${target.name}`}`;
    } catch (err) {
      if (!hasResponse(err)) {
        await outbox.addToOutbox({
          id: genId(),
          kind: "time-entry-create",
          payload,
          idempotencyKey,
          createdAt: Date.now(),
          retries: 0,
        });
        return `Saved offline — ${minutes} min will sync when you're back on`;
      }
      if (isPlanLimitError(err)) {
        throw new Error("You've reached today's plan limit for tracked sessions. Upgrade or wait for a new day.");
      }
      throw new Error("Couldn't save that time entry. Please try again.");
    }
  }, []);

  /**
   * Appends a spoken sentence to today's journal entry — the same
   * upsert-by-date shape journal.tsx's own `handleSave` uses (create on the
   * first save for a date, update against the id after), fetched fresh
   * rather than read from whatever this tab happens to have cached, since
   * this tab has no reason to have opened today's entry before now.
   */
  const appendToJournal = useCallback(async (text: string): Promise<string> => {
    const date = todayKey();
    const entryKey = journalQueries.journalQueries.byDate(date);
    // Same reasoning as appendToNote's own fetchQuery guard just above:
    // this GET has no offline queue of its own, so an unguarded failure
    // here would otherwise leak a raw axios error straight past the
    // friendly handling the write below already has.
    const existing = await queryClient.fetchQuery(journalQueries.byDate(date)).catch((err: unknown) => {
      throw new Error(hasResponse(err) ? "Couldn't load today's journal entry. Please try again." : OFFLINE_MESSAGE);
    });
    const isCreate = !existing?.id || existing.pendingSync === true;
    const nextContent = appendJournalParagraph(existing?.content ?? "", text);

    try {
      const response = isCreate
        ? await apiClient.journal.create({ date, content: nextContent })
        : await apiClient.journal.update(existing!.id, { content: nextContent });
      queryClient.setQueryData(entryKey, response.data);
      void queryClient.invalidateQueries({ queryKey: journalQueries.journalQueries.all });
      return "Added to today's journal";
    } catch (err) {
      const kind = isCreate ? "journal-create" : "journal-update";
      const payload = isCreate ? { date, content: nextContent } : { id: existing!.id, data: { content: nextContent } };
      const queued = await queueOfflineEdit(kind, payload, err);
      if (queued) {
        queryClient.setQueryData<JournalEntry>(entryKey, {
          id: existing?.id ?? genId(),
          date,
          content: nextContent,
          pendingSync: true,
        });
        return "Saved offline — will add to your journal once you're back online";
      }
      throw new Error("Couldn't save that to your journal. Please try again.");
    }
  }, []);

  /** Parks a note plan as an on-screen question, or reports it failed outright. Never a bare 'run' — see NotePlan's header. */
  const runNotePlan = useCallback((plan: NotePlan): VoiceCommandOutcome => {
    switch (plan.kind) {
      case "escalate":
        // The only caller filters this out before reaching here; kept so
        // the switch stays exhaustive against NotePlan's full union.
        return { kind: "handoff" };
      case "reject":
        return { kind: "failed", message: plan.message };
      case "choose":
        setNotePending({ kind: "choose", heardName: plan.heardName, candidates: plan.candidates, intent: plan.intent });
        return { kind: "handoff" };
      case "confirm-append":
        setNotePending({ kind: "confirm-append", target: plan.target, content: plan.content, message: plan.message });
        return { kind: "handoff" };
    }
  }, []);

  const runCoachTurn = useCallback(
    async (transcript: string): Promise<VoiceCommandOutcome> => {
      const turnId = nextTurnId.current++;
      // Appended, not assigned — whatever is already in `history` (an
      // earlier answer, its proposal cards) stays exactly where it is.
      setHistory((current) => [...current, { id: turnId, transcript, reply: "", streaming: true }]);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const patchTurn = (patch: Partial<Pick<Turn, "reply" | "streaming">>) => {
        setHistory((current) => current.map((turn) => (turn.id === turnId ? { ...turn, ...patch } : turn)));
      };

      try {
        const stream = await apiClient.coach.streamChat(scopeKey, transcript, { signal: controller.signal });
        let accumulated = "";
        let streamError: string | undefined;
        for await (const chunk of stream) {
          if (chunk.delta) {
            accumulated += chunk.delta;
            patchTurn({ reply: accumulated, streaming: true });
          }
          if (chunk.error) streamError = chunk.error;
          if (chunk.done) break;
        }

        if (streamError !== undefined) {
          // Only THIS turn goes away — a failed follow-up must not take the
          // conversation it followed on from down with it. The failure
          // itself surfaces through the dock's status line, not the thread.
          removeTurn(turnId);
          return { kind: "failed", message: streamError };
        }

        patchTurn({ reply: accumulated, streaming: false });
        // The turn is persisted server-side, so the Coach chat screen has to
        // refetch or the same conversation reads differently depending on
        // which door you came in through.
        void queryClient.invalidateQueries({ queryKey: coachQueries.coachQueries.chat(scopeKey) });
        // Every successful send is the only signal this scopeKey ever gets
        // recorded as a "Previous chats" entry — there's no server endpoint
        // that would tell a later History-sheet open this conversation
        // exists otherwise. Fire-and-forget: a lost write here costs the
        // user a stale preview line, not a functional failure.
        void recordConversationActivity(scopeKey, accumulated || transcript);

        // 'handoff', not 'done': the answer is now on screen — prose, and
        // possibly a change waiting to be confirmed. Flashing a success tick
        // over a question the assistant just asked would read as though the
        // change had already been made.
        return { kind: "handoff" };
      } catch (err) {
        if (controller.signal.aborted) return { kind: "handoff" };
        removeTurn(turnId);
        const status = (err as { status?: number } | undefined)?.status;
        return {
          kind: "failed",
          message:
            status === 429
              ? RATE_LIMIT_MESSAGE
              : // postCoachStream (packages/shared/src/api/coach.ts) only ever
                // sets `.status` once a response actually came back from the
                // server — see its header. No status at all means the fetch
                // call itself threw (DNS failure, no signal, a dropped
                // connection mid-stream): the same "nothing answered" case
                // `hasResponse` reads off axios' `.response` elsewhere in
                // this app. Surfacing that raw exception (e.g. "Fetch
                // failed: java.net.UnknownHostException ... Unable to
                // resolve host api.goalslot.io") straight to the user is
                // exactly what this branch used to do — now it doesn't.
                status !== undefined && err instanceof Error
                  ? err.message
                  : OFFLINE_MESSAGE,
        };
      } finally {
        abortRef.current = null;
      }
    },
    [removeTurn, scopeKey],
  );

  /**
   * The three-tier voice routing pipeline — see
   * src/components/voice/voice-router.ts's header for the full breakdown of
   * why each tier exists and what it hands to the next one.
   *
   * Tier 1 (instant, zero network): the local `parseVoiceCommand` classifier
   * tried against BOTH command families it knows — note-append, then
   * tracking. Only an utterance that explicitly ends in "...notes"/"...page(s)"
   * resolves to APPEND_NOTE at all (see splitContentAndTarget's note-kind-word
   * gate in packages/shared/src/voice/parse.ts); tracking recognises a fixed
   * set of start/stop/pause/resume/log phrasings (see tracking-commands.ts).
   * Anything neither recognises parses UNKNOWN and both plans come back
   * 'escalate'.
   *
   * Tier 2 (fast network call): reached only on that double escalation.
   * POST /coach/voice-intent classifies the transcript against the exact
   * same goals/tasks Tier 1's own candidates were built from, so a
   * confidently-resolved tracking target needs no second local match — see
   * `resolveTier2Target`.
   *
   * Tier 3 (unchanged): the full Coach chat, for anything neither tier above
   * was willing to act on, or if Tier 2 itself fails outright (network, 5xx)
   * — the one path guaranteed to still work, exactly what this screen always
   * fell back to before Tier 2 existed.
   */
  const handleCommand = useCallback(
    async (transcript: string): Promise<VoiceCommandOutcome> => {
      const intent = parseVoiceCommand(transcript);

      const notePlan = planNoteCommand({ intent, candidates: noteCandidates });
      if (notePlan.kind !== "escalate") return runNotePlan(notePlan);

      const trackingPlan = planTrackingCommand({ intent, timerStatus: effectiveTimerStatus, candidates: trackingCandidates });
      if (trackingPlan.kind !== "escalate") return runTrackingPlan(trackingPlan);

      if (!shouldEscalateToTier2(intent)) {
        // Unreachable — both plans above escalate under exactly the same
        // condition `shouldEscalateToTier2` checks (intent === UNKNOWN).
        // Kept so this function reads top-to-bottom as the three tiers in
        // order, rather than relying on that coincidence staying true.
        return runCoachTurn(transcript);
      }

      try {
        const context: CoachVoiceIntentContext = {
          candidateGoals: (goalsQuery.data ?? []).map((goal) => ({ id: goal.id, title: goal.title })),
          candidateTasks: (tasksQuery.data ?? []).map((task) => ({
            id: task.id,
            title: task.title,
            ...(task.goalId ? { goalId: task.goalId } : {}),
          })),
          timerStatus: effectiveTimerStatus,
        };
        const res = await apiClient.coach.voiceIntent(transcript, context);
        const route = routeVoiceIntentResponse(res.data);

        if (route.kind === "track") {
          // Rebuilds the same `TrackingPlan` Tier 1 would produce, so
          // execution goes through the one tested `runTrackingPlan` path
          // regardless of which tier resolved the command. `forcedTarget`
          // skips local fuzzy matching entirely — Tier 2 already resolved
          // the name against the exact candidates this request just sent it.
          const forcedTarget = route.target === null ? undefined : resolveTier2Target(route.target);
          const syntheticIntent: ActionableVoiceIntent = {
            type:
              route.action === "start"
                ? "START_TRACKING"
                : route.action === "stop"
                  ? "STOP_TRACKING"
                  : route.action === "pause"
                    ? "PAUSE"
                    : "RESUME",
            target: NO_TARGET,
            transcript,
            confidence: 1,
          };
          const plan = planTrackingCommand({
            intent: syntheticIntent,
            timerStatus: effectiveTimerStatus,
            candidates: trackingCandidates,
            forcedTarget,
          });
          return runTrackingPlan(plan);
        }

        if (route.kind === "journal") {
          try {
            return { kind: "done", message: await appendToJournal(route.text) };
          } catch (err) {
            return { kind: "failed", message: err instanceof Error ? err.message : "Couldn't save that to your journal." };
          }
        }

        return runCoachTurn(transcript);
      } catch {
        // The classifier call itself failed — fall back to the one path
        // guaranteed to still work.
        return runCoachTurn(transcript);
      }
    },
    [
      appendToJournal,
      effectiveTimerStatus,
      goalsQuery.data,
      noteCandidates,
      resolveTier2Target,
      runCoachTurn,
      runNotePlan,
      runTrackingPlan,
      tasksQuery.data,
      trackingCandidates,
    ],
  );

  const handlePickNoteCandidate = useCallback(
    (target: ResolvedTarget) => {
      if (notePending?.kind !== "choose") return;
      const plan = planNoteCommand({ intent: notePending.intent, candidates: noteCandidates, forcedTarget: target });
      runNotePlan(plan);
    },
    [noteCandidates, notePending, runNotePlan],
  );

  const handleConfirmAppend = useCallback(() => {
    if (notePending?.kind !== "confirm-append") return;
    const { target, content } = notePending;
    setNotePending(null);
    setNoteNotice(null);
    setNoteBusy(true);
    void appendToNote(target, content)
      .then((message) => setNoteNotice(message))
      .catch((err: unknown) => {
        hapticWarning();
        setNoteNotice(err instanceof Error ? err.message : "Couldn't save that to the page.");
      })
      .finally(() => setNoteBusy(false));
  }, [appendToNote, notePending]);

  /** The choose panel's escape hatch — runs the ORIGINAL words through the
   *  Coach directly, bypassing planNoteCommand entirely so an ambiguous
   *  page name can't just re-plan straight back into the same 'choose'. */
  const askCoachInstead = useCallback(() => {
    if (notePending?.kind !== "choose") return;
    const { transcript } = notePending.intent;
    setNotePending(null);
    void runCoachTurn(transcript);
  }, [notePending, runCoachTurn]);

  const handlePickTrackingCandidate = useCallback(
    (target: ResolvedTarget) => {
      if (trackingPending?.kind !== "choose") return;
      const plan = planTrackingCommand({
        intent: trackingPending.intent,
        timerStatus: effectiveTimerStatus,
        candidates: trackingCandidates,
        forcedTarget: target,
      });
      setTrackingNotice(null);
      void runTrackingPlan(plan).then((outcome) => {
        if (outcome.kind === "failed") hapticWarning();
        if (outcome.kind !== "handoff") setTrackingNotice(outcome.message);
      });
    },
    [effectiveTimerStatus, runTrackingPlan, trackingCandidates, trackingPending],
  );

  const handleConfirmTrackingLog = useCallback(() => {
    if (trackingPending?.kind !== "confirm-log") return;
    const { minutes, target } = trackingPending;
    setTrackingPending(null);
    setTrackingNotice(null);
    setTrackingBusy(true);
    void logTrackedTime(minutes, target)
      .then((message) => setTrackingNotice(message))
      .catch((err: unknown) => {
        hapticWarning();
        setTrackingNotice(err instanceof Error ? err.message : "Couldn't save that time entry.");
      })
      .finally(() => setTrackingBusy(false));
  }, [logTrackedTime, trackingPending]);

  /** The tracking choose panel's escape hatch — same shape as `askCoachInstead` above. */
  const askCoachInsteadForTracking = useCallback(() => {
    if (trackingPending?.kind !== "choose") return;
    const { transcript } = trackingPending.intent;
    setTrackingPending(null);
    void runCoachTurn(transcript);
  }, [runCoachTurn, trackingPending]);

  const { state, start, stop, cancel, reset, openSettings } = useVoiceCapture({
    voice,
    onCommand: handleCommand,
    label: "Voice assistant",
  });

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Opening the tab IS the press of a mic button, so it listens straight
  // away rather than making the user tap a second, redundant control on a
  // screen whose entire purpose is the microphone. Two things suppress that:
  // an answer already on screen (coming back to re-read a result must not
  // silently reopen the mic), and a transcript forwarded from the tracker,
  // which is run instead of asking the user to repeat themselves.
  const hasAnswer = history.length > 0;
  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "voice" } });
      // Re-checked on every focus, same reason timer.tsx does this: a
      // session started from the Coach, from another device, or from the
      // Time Tracker's own mic while this tab wasn't visible would otherwise
      // stay invisible to `hasServerSession` until some unrelated refetch
      // happened to run.
      void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      if (typeof forwarded === "string" && forwarded.length > 0 && forwardedRef.current !== forwarded) {
        forwardedRef.current = forwarded;
        void handleCommand(forwarded).then((outcome) => {
          // handleCommand already removed its own (empty) turn on failure —
          // this re-adds just the transcript so the words the tracker's mic
          // heard stay visible next to the error in the status line, since
          // the user never got to see them appear live the way they would
          // have on this screen's own mic.
          if (outcome.kind === "failed") {
            setHistory((current) => [
              ...current,
              { id: nextTurnId.current++, transcript: forwarded, reply: "", streaming: false },
            ]);
          }
        });
      } else if (!hasAnswer) {
        void start();
      }
      return () => {
        // Navigating away closes the microphone. Always. Leaving it open
        // behind another screen is the one behaviour that would make this
        // feature untrustworthy.
        void cancel();
        abortRef.current?.abort();
        // A note question left pending from this visit must not still be
        // sitting there — offering a stale "Add it?" for a page the user
        // may have since deleted — the moment they come back to this tab.
        setNotePending(null);
        // Same rule for a tracking question — a stale "Which one?" for a
        // goal that's since been renamed or a session that's since ended.
        setTrackingPending(null);
      };
      // `hasAnswer` is deliberately absent from the dependencies: it flips
      // the moment a reply starts arriving, and re-running this effect then
      // would fire the cleanup below and cancel the very stream that
      // produced it. It is read once per focus, which is when it matters.
    }, [analytics, cancel, forwarded, handleCommand, start]),
  );

  const handleMicPress = useCallback(() => {
    if (state.status === "listening") {
      void stop();
      return;
    }
    if (state.status === "permission-denied") {
      openSettings();
      return;
    }
    if (state.status === "processing" || noteBusy || trackingBusy) return;
    // No history reset here. Starting a new recording is a follow-up turn
    // in the same thread, not a fresh conversation — see the note on
    // `history` above. `handleCommand` appends the new turn once there is
    // a transcript to append; nothing needs to happen to the old ones now.
    setNotePending(null);
    setTrackingPending(null);
    void start();
  }, [noteBusy, openSettings, start, state.status, stop, trackingBusy]);

  const applyActions = useCallback(
    (actions: CoachProposalAction[]) => apply({ actions }),
    [apply],
  );

  const openHistory = useCallback(() => {
    historySheetRef.current?.present();
  }, []);

  // "New chat" confirmation state — see `ConfirmDialog` below the JSX return
  // for why this is a themed modal rather than `Alert.alert`. `newChatError`
  // is rendered INSIDE that same dialog on a failed clear, rather than
  // stacking a second Alert on top of the first the way the old
  // `Alert.alert(...); Alert.alert("Couldn't start a new chat", ...)` pairing
  // did — the dialog just stays open with the reason and a retry.
  const [newChatConfirmVisible, setNewChatConfirmVisible] = useState(false);
  const [newChatBusy, setNewChatBusy] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);

  /**
   * "New chat": unavoidably destructive server-side (see the module header —
   * one conversation per user+scopeKey, no thread ids to spin a fresh one up
   * under). The confirm copy says so plainly rather than implying anything
   * is being "saved" in a way the assistant can still use.
   */
  const handleNewChat = useCallback(() => {
    if (history.length === 0) {
      // Nothing to lose — skip the confirm and the archive both.
      return;
    }
    setNewChatError(null);
    setNewChatConfirmVisible(true);
  }, [history.length]);

  const cancelNewChat = useCallback(() => {
    if (newChatBusy) return;
    setNewChatConfirmVisible(false);
    setNewChatError(null);
  }, [newChatBusy]);

  /**
   * Snapshot -> server clear -> local reset, in that order, so a failed
   * clear never leaves an archived-but-still-live duplicate hanging around —
   * the snapshot itself is cheap and local, so taking it unconditionally
   * first and only acting on it if the clear actually succeeds costs
   * nothing.
   */
  const confirmNewChat = useCallback(() => {
    if (newChatBusy) return;
    setNewChatBusy(true);
    setNewChatError(null);
    void (async () => {
      const snapshot = turnsToArchiveSnapshot(history);
      if (snapshot.length > 0) {
        await archiveConversation(scopeKey, snapshot);
      }
      try {
        await apiClient.coach.clearChatHistory(scopeKey);
      } catch {
        // The server still has the old conversation — leave the screen
        // exactly as it was rather than pretending the clear happened. The
        // snapshot just taken is harmless either way: it'll sit in Previous
        // chats as an extra copy if the user retries and succeeds later.
        setNewChatBusy(false);
        setNewChatError("Couldn't start a new chat. Please try again.");
        return;
      }
      setHistory([]);
      setDismissedProposals(new Map());
      void queryClient.invalidateQueries({ queryKey: coachQueries.coachQueries.chat(scopeKey) });
      void markLiveConversationReset(scopeKey);
      setNewChatBusy(false);
      setNewChatConfirmVisible(false);
    })();
  }, [history, newChatBusy, scopeKey]);

  const dismissProposal = useCallback((turnId: number, index: number) => {
    setDismissedProposals((current) => {
      const next = new Map(current);
      const existing = next.get(turnId) ?? EMPTY_DISMISSED;
      const updated = new Set(existing);
      updated.add(index);
      next.set(turnId, updated);
      return next;
    });
  }, []);

  // Cache of already-parsed replies, keyed by turn id. extractCoachProposals
  // does real work per turn (a regex extraction plus a lenient-JSON parse for
  // every ```coach-proposal block), and the `turns` useMemo below has to
  // depend on the whole `history` array — but `patchTurn` (inside
  // `runCoachTurn`) gives `history` a brand-new array reference on every
  // streamed token, which meant EVERY turn already on screen was being
  // re-parsed on every chunk of whichever turn is currently streaming, not
  // just that one. This cache is what actually makes "a turn only re-parses
  // when its own reply changes" true, rather than just documented.
  const parseCacheRef = useRef(new Map<number, { reply: string; parsed: ReturnType<typeof extractCoachProposals> }>());

  // Every turn, parsed once per render — each carries its own reply text,
  // so a turn already on screen from an earlier command never re-parses
  // when a later one streams in.
  const turns = useMemo(() => {
    const cache = parseCacheRef.current;
    const nextCache = new Map<number, { reply: string; parsed: ReturnType<typeof extractCoachProposals> }>();
    const result = history.map((turn) => {
      const cached = cache.get(turn.id);
      const parsed = cached && cached.reply === turn.reply ? cached.parsed : extractCoachProposals(turn.reply);
      nextCache.set(turn.id, { reply: turn.reply, parsed });
      const dismissed = dismissedProposals.get(turn.id) ?? EMPTY_DISMISSED;
      const visibleProposals = parsed.proposals
        .map((block, index) => ({ block, index }))
        .filter(({ index }) => !dismissed.has(index));
      return { turn, parsed, visibleProposals };
    });
    // Turns removed from `history` (see removeTurn) simply don't get carried
    // into the next cache — nothing to evict explicitly.
    parseCacheRef.current = nextCache;
    return result;
  }, [dismissedProposals, history]);
  const latestReply = history.length > 0 ? history[history.length - 1].reply : "";
  const totalVisibleProposals = turns.reduce((sum, { visibleProposals }) => sum + visibleProposals.length, 0);

  // Deferred by a frame, and keyed on the visible proposal count, the
  // latest reply's text and the number of turns, so a scroll is triggered
  // by a new turn appearing as much as by the current one streaming. The
  // cards mount in the same commit as the reply that produced them, so a
  // synchronous scrollToEnd measures a content size taken from before they
  // laid out — which is how a batch of a dozen actions ended up with its
  // Apply button parked below the fold with nothing on screen suggesting
  // there was more card to scroll to.
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [history.length, latestReply, totalVisibleProposals]);

  const statusLine = (() => {
    switch (state.status) {
      case "listening":
        return state.transcript.length > 0 ? state.transcript : "Listening…";
      case "processing":
        return "Thinking…";
      case "success":
      case "error":
      case "permission-denied":
      case "unavailable":
        return state.message;
      default:
        // A confirmed (or failed) append/log lands here — by the time it
        // settles, `state` is already back to idle (see appendToNote's and
        // logTrackedTime's callers: neither runs through useVoiceCapture's
        // own `onCommand`, so there is no 'success'/'error' state for either
        // to occupy).
        if (trackingNotice !== null) return trackingNotice;
        if (noteNotice !== null) return noteNotice;
        return !hasAnswer ? "Tap the mic and say what you need" : "Tap the mic to ask something else";
    }
  })();

  const blocked = state.status === "permission-denied" || state.status === "unavailable";
  // "Thinking…" as a bare string reads as a screen that's stalled the
  // instant a reply takes more than a second or two. The dock swaps in the
  // same animated dot wave Coach's chat bubble uses instead; `statusLine`
  // above still computes "Thinking…" so screen readers get the words even
  // though sighted users see the dots.
  const isThinking = state.status === "processing";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Voice
        </Text>
        <Text style={styles.subtitle}>Powered by GoalSlot AI — the same assistant as Coach</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {!hasAnswer ? (
          <View style={styles.examples}>
            <Text style={styles.examplesLabel}>Try saying</Text>
            {EXAMPLES.map((example) => (
              <View key={example} style={styles.exampleRow}>
                <Icon name="chevron" size={iconSize.xs} color={colors.mutedForegroundLight} />
                <Text style={styles.exampleText}>{example}</Text>
              </View>
            ))}
          </View>
        ) : (
          // Every turn stays mounted — a new recording appends a turn below
          // the last one rather than replacing it, so a follow-up reads as
          // a continuation of the same conversation, not a reset of it.
          <View style={styles.thread}>
            {turns.map(({ turn, parsed, visibleProposals }, turnPosition) => (
              <View key={turn.id} style={styles.turn}>
                {turnPosition > 0 ? <View style={styles.turnDivider} /> : null}

                <View style={styles.saidBubble}>
                  <Text style={styles.saidLabel}>You said</Text>
                  <Text style={styles.saidText}>{turn.transcript}</Text>
                </View>

                {parsed.cleaned.length > 0 ? (
                  <View style={styles.replyBubble} accessibilityLiveRegion="polite">
                    <FormattedText text={parsed.cleaned} style={styles.replyText} />
                  </View>
                ) : null}

                {parsed.pending ? <Text style={styles.pendingText}>Preparing a change…</Text> : null}

                {!parsed.pending && parsed.unrenderable ? (
                  <Text style={styles.unrenderableText} accessibilityRole="alert">
                    Something went wrong preparing that change. Try asking again.
                  </Text>
                ) : null}

                {visibleProposals.length > 0 ? (
                  <View style={styles.proposals}>
                    {visibleProposals.length > 1 ? (
                      <Text style={styles.proposalsLabel}>
                        {visibleProposals.length} changes waiting for your OK
                      </Text>
                    ) : null}
                    {visibleProposals.map(({ block, index }) => (
                      <CoachProposalCard
                        key={index}
                        block={block}
                        onApply={applyActions}
                        onDismiss={() => dismissProposal(turn.id, index)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.dock}>
        {notePending?.kind === "choose" ? (
          <View style={styles.notePanel} accessibilityLiveRegion="polite">
            <Text style={styles.notePanelTitle}>
              {notePending.candidates.length > 0
                ? `Heard "${notePending.heardName}". Which page?`
                : `Heard "${notePending.heardName}" — no page matches that.`}
            </Text>
            {/* Never a silent fallback to the first page in the list: the
                whole reason this command asks by name is that guessing
                wrong writes into the wrong page. */}
            {notePending.candidates.map((candidate) => (
              <Pressable
                key={candidate.id}
                onPress={() => handlePickNoteCandidate(candidate)}
                accessibilityRole="button"
                accessibilityLabel={candidate.name}
                style={({ pressed }) => [styles.noteCandidateRow, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.noteCandidateName}>{candidate.name}</Text>
              </Pressable>
            ))}
            <View style={styles.notePanelActions}>
              <Pressable
                onPress={() => setNotePending(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.noteSecondaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.noteSecondaryLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={askCoachInstead}
                accessibilityRole="button"
                accessibilityLabel="Ask GoalSlot AI instead"
                style={({ pressed }) => [styles.notePrimaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.notePrimaryLabel}>Ask GoalSlot AI</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {notePending?.kind === "confirm-append" ? (
          <View style={styles.notePanel} accessibilityLiveRegion="polite">
            {/* Confirmed, unlike start/stop/pause/resume on the Tracker's own
                mic: this permanently writes unreviewed spoken text into a
                page, and a misheard word would sit there unnoticed. */}
            <Text style={styles.notePanelTitle}>{notePending.message}</Text>
            <View style={styles.notePanelActions}>
              <Pressable
                onPress={() => setNotePending(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel, don't add this"
                style={({ pressed }) => [styles.noteSecondaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.noteSecondaryLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmAppend}
                disabled={noteBusy}
                accessibilityRole="button"
                accessibilityLabel={`Add "${notePending.content}" to ${notePending.target.name}`}
                accessibilityState={{ disabled: noteBusy, busy: noteBusy }}
                style={({ pressed }) => [styles.notePrimaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.notePrimaryLabel}>{noteBusy ? "Adding…" : "Add it"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Mirrors the note panels above (and TrackerVoiceButton's own
            choose/confirm-log panels) — same shape of question, same visual
            treatment, so it reads as the same feature even though it's
            reached through a different mic and a different command family. */}
        {trackingPending?.kind === "choose" ? (
          <View style={styles.notePanel} accessibilityLiveRegion="polite">
            <Text style={styles.notePanelTitle}>
              {trackingPending.candidates.length > 0
                ? `Heard "${trackingPending.heardName}". Which one?`
                : `Heard "${trackingPending.heardName}" — nothing matches that.`}
            </Text>
            {/* Never a silent fallback to an unattributed timer: the whole
                reason this feature exists is a goal the user could not find. */}
            {trackingPending.candidates.map((candidate) => (
              <Pressable
                key={`${candidate.kind}-${candidate.id}`}
                onPress={() => handlePickTrackingCandidate(candidate)}
                accessibilityRole="button"
                accessibilityLabel={`${candidate.name}, ${candidate.kind}`}
                style={({ pressed }) => [styles.noteCandidateRow, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.noteCandidateName}>{candidate.name}</Text>
              </Pressable>
            ))}
            <View style={styles.notePanelActions}>
              <Pressable
                onPress={() => setTrackingPending(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.noteSecondaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.noteSecondaryLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={askCoachInsteadForTracking}
                accessibilityRole="button"
                accessibilityLabel="Ask GoalSlot AI instead"
                style={({ pressed }) => [styles.notePrimaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.notePrimaryLabel}>Ask GoalSlot AI</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {trackingPending?.kind === "confirm-log" ? (
          <View style={styles.notePanel} accessibilityLiveRegion="polite">
            {/* Confirmed, unlike start/stop/pause/resume: this writes a
                record with a duration nobody measured, and a misheard digit
                would sit in the user's reporting unnoticed. */}
            <Text style={styles.notePanelTitle}>{trackingPending.message}</Text>
            <View style={styles.notePanelActions}>
              <Pressable
                onPress={() => setTrackingPending(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel, don't log this time"
                style={({ pressed }) => [styles.noteSecondaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.noteSecondaryLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmTrackingLog}
                disabled={trackingBusy}
                accessibilityRole="button"
                accessibilityLabel={`Log ${trackingPending.minutes} minutes${trackingPending.target === null ? "" : ` to ${trackingPending.target.name}`}`}
                accessibilityState={{ disabled: trackingBusy, busy: trackingBusy }}
                style={({ pressed }) => [styles.notePrimaryButton, pressed && styles.noteRowPressed]}
              >
                <Text style={styles.notePrimaryLabel}>{trackingBusy ? "Logging…" : "Log it"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.statusLine} accessibilityLiveRegion="polite" accessibilityLabel={statusLine}>
          {isThinking ? (
            <TypingIndicator size={8} />
          ) : (
            <Text style={[styles.statusLineText, blocked && styles.statusLineBlocked]} numberOfLines={3}>
              {statusLine}
            </Text>
          )}
        </View>

        <CoachBudgetNotice
          error={state.status === "error" ? state.message : null}
          style={{ alignSelf: "stretch" }}
        />

        <MicOrb
          status={state.status}
          onPress={handleMicPress}
          size={84}
          accessibilityLabel={
            state.status === "listening"
              ? "Stop listening"
              : state.status === "permission-denied"
                ? "Open Settings to allow microphone access"
                : "Start listening"
          }
          accessibilityHint={
            state.status === "listening" ? undefined : "Say a command such as start tracking my deen goal"
          }
        />

        <View style={styles.dockActions}>
          {state.status === "listening" ? (
            <PressableScale
              onPress={() => void cancel()}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Cancel and discard what you said"
              style={[styles.dockChip, styles.dockChipTransient]}
            >
              <Icon name="close" size={iconSize.sm} color={colors.mutedForeground} />
              <Text style={styles.dockChipLabel}>Cancel</Text>
            </PressableScale>
          ) : null}

          {state.status === "error" ? (
            <PressableScale
              onPress={reset}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this message"
              style={[styles.dockChip, styles.dockChipTransient]}
            >
              <Icon name="close" size={iconSize.sm} color={colors.mutedForeground} />
              <Text style={styles.dockChipLabel}>Dismiss</Text>
            </PressableScale>
          ) : null}

          {/* Always present, in every state. Voice is an alternative way in,
              never the only one — someone who cannot speak, will not speak
              here, or is on a device with no recognizer gets the identical
              feature one tap away. */}
          <PressableScale
            onPress={() => router.push("/coach")}
            accessibilityRole="link"
            accessibilityLabel="Type your request instead, in Coach chat"
            style={[styles.dockChip, blocked && styles.dockChipStrong]}
          >
            <Icon name="keyboard" size={iconSize.sm} color={blocked ? colors.foreground : colors.mutedForeground} />
            <Text style={[styles.dockChipLabel, blocked && styles.dockChipLabelStrong]}>Type instead</Text>
          </PressableScale>

          <PressableScale
            onPress={openHistory}
            accessibilityRole="button"
            accessibilityLabel="Previous chats"
            accessibilityHint="Browse and reopen earlier conversations with the Coach"
            style={styles.dockChip}
          >
            <Icon name="inbox" size={iconSize.sm} color={colors.mutedForeground} />
            <Text style={styles.dockChipLabel}>Previous chats</Text>
          </PressableScale>

          {/* Only offered once there's something on screen worth clearing —
              see handleNewChat, which also no-ops on an empty thread. */}
          {hasAnswer ? (
            <PressableScale
              onPress={handleNewChat}
              accessibilityRole="button"
              accessibilityLabel="Start a new chat"
              accessibilityHint="Clears the assistant's memory of this conversation, after asking to confirm"
              style={styles.dockChip}
            >
              <Icon name="add" size={iconSize.sm} color={colors.mutedForeground} />
              <Text style={styles.dockChipLabel}>New chat</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>

      <ConfirmDialog
        visible={newChatConfirmVisible}
        title="Start a new chat?"
        description="This clears the assistant's memory of the current conversation. It'll stay in Previous chats, but the assistant won't remember it anymore."
        icon="add"
        confirmLabel="Start new chat"
        cancelLabel="Cancel"
        destructive
        busy={newChatBusy}
        error={newChatError}
        onConfirm={confirmNewChat}
        onCancel={cancelNewChat}
      />

      <CoachHistorySheet ref={historySheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    // Clears the floating hamburger the app layout parks at top-right.
    paddingRight: 64,
    gap: spacing.xxs,
  },
  title: {
    ...typography.h1,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    // Enough room under the last card that its Apply button never sits
    // flush against the dock's top border.
    paddingBottom: spacing.xxl,
  },
  // One gap step per turn — visibly looser than the gap between elements
  // *within* a turn (`turn` below), so a follow-up reads as a new beat in
  // the conversation rather than one more line of the previous one.
  thread: {
    gap: spacing.xxl,
  },
  turn: {
    gap: spacing.md,
  },
  // Marks where a follow-up turn starts, for every turn after the first.
  // Deliberately short and centred rather than a full-width rule — a
  // full-bleed line reads as a hard section break, which overstates what is
  // still one continuous back-and-forth.
  turnDivider: {
    alignSelf: "center",
    width: 32,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: colors.border,
    borderRadius: radii.full,
  },
  // Proposal cards get their own stack so several of them read as a set
  // with an explicit gutter between them, rather than as one long run of
  // bordered boxes sharing the transcript's spacing.
  proposals: {
    gap: spacing.md,
  },
  proposalsLabel: {
    ...typography.label,
    color: colors.mutedForegroundLight,
  },
  examples: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.card,
  },
  examplesLabel: {
    ...typography.label,
    color: colors.mutedForegroundLight,
  },
  exampleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  exampleText: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  saidBubble: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    borderRadius: radii.card,
    borderBottomRightRadius: radii.sm,
    backgroundColor: colors.primary,
    // Matches coach.tsx's own bubble padding bump (spacing.md/lg, up from
    // sm/md) — sized for the same 16px/24-line-height prose text below,
    // not the shared scale's tighter UI-row padding.
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xxs,
    ...shadows.subtle,
  },
  saidLabel: {
    ...typography.label,
    color: colors.primaryForeground,
    opacity: 0.7,
  },
  // Same size bump as coach.tsx's `bubbleTextUser`/`bubbleTextAssistant` —
  // see that file's comment. Voice renders the identical Coach reply text
  // (`FormattedText`) and the same kind of spoken, often multi-sentence
  // transcript; the two screens would read as two different chat products
  // if only one of them got the readability fix.
  saidText: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.1,
    color: colors.primaryForeground,
  },
  replyBubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    borderRadius: radii.card,
    borderBottomLeftRadius: radii.sm,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.subtle,
  },
  replyText: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.1,
    color: colors.foreground,
  },
  pendingText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  // Shown when a ```coach-proposal block closed but produced nothing
  // renderable (malformed JSON, or every action's type unrecognized — e.g.
  // a journal-entry request, which has no proposal action type at all).
  // Without this, the reply text could claim a change was prepared while no
  // card ever appeared and nothing on screen said why.
  unrenderableText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
  },
  dock: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    // A touch more than the top padding: the tab bar (which owns the actual
    // home-indicator/gesture-nav inset) sits right below this, so the dock
    // needs its own bit of breathing room above it rather than relying on
    // that inset to provide it.
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    // `shadows.raised` cast upward (negative height) rather than down: this
    // panel is pinned to the bottom of the screen, so its shadow has to
    // fall into the content above it to read as floating, not off-screen
    // beneath the tab bar where nothing would ever see it.
    ...shadows.raised,
    shadowOffset: { width: 0, height: -shadows.raised.shadowOffset.height },
    backgroundColor: colors.card,
  },
  statusLine: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  statusLineText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  statusLineBlocked: {
    color: colors.destructive,
    fontWeight: "600",
  },
  dockActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  // A real pill, not underlined text — bordered card surface + icon, the
  // same "chip" language coach.tsx's own `analyzeDayButton` quick action
  // already uses for a secondary action docked above its composer, so this
  // row reads as a deliberate control cluster rather than a row of inline
  // links that happened to land at the bottom of the screen.
  dockChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    ...shadows.subtle,
  },
  // Cancel/Dismiss only ever appear for the few seconds a recording or an
  // error is on screen — a flatter, borderless fill keeps them visually
  // subordinate to the three chips that are always there (Type instead,
  // Previous chats, New chat), instead of competing with them at the same
  // weight.
  dockChipTransient: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
    shadowOpacity: 0,
    elevation: 0,
  },
  // "Type instead" is the one chip whose importance changes with state: once
  // voice is blocked (denied permission / no recognizer) it's no longer an
  // alternative, it's the only way in, so it gets the stronger treatment the
  // plain-text version signalled with `textActionLabelStrong` before.
  dockChipStrong: {
    borderColor: colors.foreground,
  },
  dockChipLabel: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  dockChipLabelStrong: {
    color: colors.foreground,
  },
  // Mirrors TrackerVoiceButton's `.panel`/candidateRow/panelActions
  // styles — same shape of question (heard a name, need a pick or a
  // confirm), same visual treatment, so it reads as the same feature even
  // though it lives on a different mic.
  notePanel: {
    width: "100%",
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  notePanelTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  noteCandidateRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  noteCandidateName: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  notePanelActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  noteRowPressed: {
    opacity: 0.75,
  },
  noteSecondaryButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteSecondaryLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  notePrimaryButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.primary,
  },
  notePrimaryLabel: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
