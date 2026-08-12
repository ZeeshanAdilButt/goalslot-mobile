// The Time Tracker's own microphone. A different interaction from the tab
// bar's, on purpose.
//
// The tab-bar mic is open-ended: anything the assistant can do, routed
// through GoalSlot AI, answered with a proposal to confirm. That round trip
// is right for "move my study block to 7pm" and absurd for "stop".
//
// Here the vocabulary is small, closed and unambiguous — start, stop, pause,
// resume, and log N minutes — so the transcript is parsed on the device by
// packages/shared/src/voice and acted on immediately. No model, no network,
// no dialog for the four reversible ones. Saying "pause" should feel exactly
// as fast as pressing Pause, or nobody will say it twice.
//
// Anything that is NOT one of those five falls through to the tab-bar
// assistant with the transcript carried over, rather than being guessed at.
// There is no third execution path: this component either drives the timer
// store directly, or hands the words to the Coach pipeline.
//
// SELF-CONTAINED except for one thing. Stopping has to write a TimeEntry,
// and the Time Tracker screen already owns that — the payload assembly, the
// offline outbox fallback, the retry alert, the double-stop guard. Rather
// than grow a second copy that could disagree with it, `onStopSession` hands
// the stop back to that one handler. Mounting this is an import and one
// element.

import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  createTimeEntrySchema,
  genId,
  getLocalDateString,
  parseVoiceCommand,
  type ActionableVoiceIntent,
  type CreateTimeEntryInput,
  type ResolvedTarget,
} from "@goalslot/shared";

import { MicOrb } from "@/components/voice/MicOrb";
import { buildTrackingCandidates, planTrackingCommand, type TrackingPlan } from "@/components/voice/tracking-commands";
import { useVoiceCapture, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import { apiClient } from "@/lib/api-client";
import { hapticCompletion, hapticWarning } from "@/lib/haptics";
import { outbox } from "@/lib/offline";
import { goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useTimerStore } from "@/lib/timer-store";
import { useAnalytics } from "@/providers/growth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Matches `hasResponse` in src/hooks/useQuickAdd.ts and packages/shared/src/offline/sync.ts. */
function hasResponse(err: unknown): boolean {
  return Boolean((err as { response?: unknown } | undefined)?.response);
}

const UNRESOLVED_TARGET_LABEL = "Focus session";

export interface TrackerVoiceButtonProps {
  /**
   * The Time Tracker's own stop handler — the one that assembles the
   * TimeEntry, falls back to the outbox offline, and guards against a double
   * stop. Voice calls it rather than reimplementing it.
   */
  onStopSession: () => void;
}

/** A question waiting on the user, held while the mic is back at rest. */
type Pending =
  | { kind: "choose"; heardName: string; candidates: readonly ResolvedTarget[]; intent: ActionableVoiceIntent }
  | { kind: "confirm-log"; minutes: number; target: ResolvedTarget | null; message: string };

export function TrackerVoiceButton({ onStopSession }: TrackerVoiceButtonProps) {
  const router = useRouter();
  const analytics = useAnalytics();
  const { voice } = useCapabilities();

  const status = useTimerStore((s) => s.status);
  const start = useTimerStore((s) => s.start);
  const retarget = useTimerStore((s) => s.retarget);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);

  const goalsQuery = useQuery(goalQueries.list());
  const tasksQuery = useQuery(taskQueries.list());

  const [pending, setPending] = useState<Pending | null>(null);
  const [logging, setLogging] = useState(false);
  // The result of a confirmed log. It lands outside the capture state
  // machine, because by the time the user presses "Log it" the microphone
  // has long since gone back to rest.
  const [notice, setNotice] = useState<string | null>(null);

  const candidates = useMemo(
    () => buildTrackingCandidates(goalsQuery.data ?? [], tasksQuery.data ?? []),
    [goalsQuery.data, tasksQuery.data],
  );

  /**
   * Hands the words to the open-ended assistant, transcript and all, so the
   * user does not have to say it a second time into a different microphone.
   * app/(app)/voice.tsx runs it through the Coach pipeline and confirms
   * whatever comes back.
   */
  const escalate = useCallback(
    (transcript: string) => {
      setPending(null);
      router.push({ pathname: "/voice", params: { transcript } });
    },
    [router],
  );

  const logTime = useCallback(
    async (minutes: number, target: ResolvedTarget | null) => {
      setLogging(true);
      const payload: CreateTimeEntryInput = createTimeEntrySchema.parse({
        // `taskName` is required and non-empty by both the shared schema and
        // the API's DTO, so an unattributed log still needs a human phrase.
        // Same placeholder the Time Tracker uses for the same reason.
        taskName: target?.name ?? UNRESOLVED_TARGET_LABEL,
        ...(target?.kind === "task" ? { taskId: target.id, taskTitle: target.name } : {}),
        ...(target?.kind === "goal" ? { goalId: target.id } : {}),
        duration: minutes,
        date: getLocalDateString(),
      });

      try {
        await apiClient.timeEntries.create(payload);
        hapticCompletion();
        void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
        if (target?.kind === "goal") {
          void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
        }
        return `Logged ${minutes} min${target === null ? "" : ` to ${target.name}`}`;
      } catch (err) {
        if (!hasResponse(err)) {
          // Offline. Measured-and-then-dropped time is unrecoverable, so it
          // is banked rather than surfaced as a failure the user has to
          // remember to redo.
          await outbox.addToOutbox({
            id: genId(),
            kind: "time-entry-create",
            payload,
            idempotencyKey: genId(),
            createdAt: Date.now(),
            retries: 0,
          });
          return `Saved offline — ${minutes} min will sync when you're back on`;
        }
        throw new Error("Couldn't save that time entry. Please try again.");
      } finally {
        setLogging(false);
      }
    },
    [],
  );

  /** Executes a plan, or parks it as a question. Shared by speech and by a candidate tap. */
  const runPlan = useCallback(
    async (plan: TrackingPlan, transcript: string): Promise<VoiceCommandOutcome> => {
      switch (plan.kind) {
        case "escalate":
          escalate(transcript);
          return { kind: "handoff" };

        case "reject":
          return { kind: "failed", message: plan.message };

        case "choose":
          setPending({
            kind: "choose",
            heardName: plan.heardName,
            candidates: plan.candidates,
            intent: plan.intent,
          });
          return { kind: "handoff" };

        case "confirm-log":
          setPending({
            kind: "confirm-log",
            minutes: plan.minutes,
            target: plan.target,
            message: plan.message,
          });
          return { kind: "handoff" };

        case "run": {
          setPending(null);
          const goalId = plan.target?.kind === "goal" ? plan.target.id : undefined;
          const taskId = plan.target?.kind === "task" ? plan.target.id : undefined;

          switch (plan.action) {
            case "start":
              start(taskId, goalId);
              analytics.track({ name: "timerStarted", payload: { taskId } });
              break;
            case "retarget":
              retarget(taskId, goalId);
              break;
            case "pause":
              pause();
              analytics.track({ name: "timerPaused", payload: { taskId } });
              break;
            case "resume":
              resume();
              break;
            case "stop":
              // The screen owns this: it assembles the entry, queues it
              // offline, and guards a double stop. See the header.
              onStopSession();
              break;
          }
          return { kind: "done", message: plan.message };
        }
      }
    },
    [analytics, escalate, onStopSession, pause, resume, retarget, start],
  );

  const handleCommand = useCallback(
    async (transcript: string): Promise<VoiceCommandOutcome> => {
      const intent = parseVoiceCommand(transcript);
      return runPlan(planTrackingCommand({ intent, timerStatus: status, candidates }), transcript);
    },
    [candidates, runPlan, status],
  );

  const { state, start: listen, stop: stopListening, cancel, reset, openSettings } = useVoiceCapture({
    voice,
    onCommand: handleCommand,
    label: "Tracking voice control",
  });

  // Tabs stay mounted when you leave them, so nothing unmounts this on the
  // way to another screen. Without an explicit close here, switching to the
  // Voice tab mid-utterance would leave this mic believing it is still
  // listening (the shared VoiceCapability hands its listeners to whoever
  // started last) — and, worse, leave the microphone open behind a screen
  // that isn't showing it.
  useFocusEffect(
    useCallback(() => {
      return () => {
        void cancel();
        setPending(null);
      };
    }, [cancel]),
  );

  const handleMicPress = useCallback(() => {
    if (state.status === "listening") {
      void stopListening();
      return;
    }
    if (state.status === "permission-denied") {
      openSettings();
      return;
    }
    if (state.status === "processing" || logging) return;
    setPending(null);
    void listen();
  }, [listen, logging, openSettings, state.status, stopListening]);

  const handlePickCandidate = useCallback(
    (target: ResolvedTarget) => {
      if (pending?.kind !== "choose") return;
      const plan = planTrackingCommand({
        intent: pending.intent,
        timerStatus: status,
        candidates,
        forcedTarget: target,
      });
      void runPlan(plan, pending.intent.transcript);
    },
    [candidates, pending, runPlan, status],
  );

  const handleConfirmLog = useCallback(() => {
    if (pending?.kind !== "confirm-log") return;
    const { minutes, target } = pending;
    setPending(null);
    setNotice(null);
    void logTime(minutes, target)
      .then(setNotice)
      .catch((err: unknown) => {
        hapticWarning();
        setNotice(err instanceof Error ? err.message : "Couldn't save that time entry.");
      });
  }, [logTime, pending]);

  const statusLine = (() => {
    if (state.status === "listening") return state.transcript.length > 0 ? state.transcript : "Listening…";
    if (state.status === "processing") return "One moment…";
    if (state.message.length > 0) return state.message;
    if (notice !== null) return notice;
    return "Say “start tracking deen”, “pause”, or “stop”";
  })();

  const blocked = state.status === "permission-denied" || state.status === "unavailable";

  return (
    <View style={styles.container}>
      {pending?.kind === "choose" ? (
        <View style={styles.panel} accessibilityLiveRegion="polite">
          <Text style={styles.panelTitle}>
            {pending.candidates.length > 0
              ? `Heard “${pending.heardName}”. Which one?`
              : `Heard “${pending.heardName}” — nothing matches that.`}
          </Text>
          {/* Never a silent fallback to an unattributed timer: the whole
              reason this feature exists is a goal the user could not find. */}
          {pending.candidates.map((candidate) => (
            <Pressable
              key={`${candidate.kind}-${candidate.id}`}
              onPress={() => handlePickCandidate(candidate)}
              accessibilityRole="button"
              accessibilityLabel={`${candidate.name}, ${candidate.kind}`}
              style={({ pressed }) => [styles.candidateRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.candidateName}>{candidate.name}</Text>
              <Text style={styles.candidateKind}>{candidate.kind}</Text>
            </Pressable>
          ))}
          <View style={styles.panelActions}>
            <Pressable
              onPress={() => setPending(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.rowPressed]}
            >
              <Text style={styles.secondaryLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => escalate(pending.intent.transcript)}
              accessibilityRole="button"
              accessibilityLabel="Ask GoalSlot AI instead"
              style={({ pressed }) => [styles.primaryButton, pressed && styles.rowPressed]}
            >
              <Text style={styles.primaryLabel}>Ask GoalSlot AI</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {pending?.kind === "confirm-log" ? (
        <View style={styles.panel} accessibilityLiveRegion="polite">
          {/* Confirmed, unlike start/stop/pause/resume: this writes a record
              with a duration nobody measured, and a misheard digit would sit
              in the user's reporting unnoticed. */}
          <Text style={styles.panelTitle}>{pending.message}</Text>
          <View style={styles.panelActions}>
            <Pressable
              onPress={() => setPending(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel, don't log this time"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.rowPressed]}
            >
              <Text style={styles.secondaryLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirmLog}
              disabled={logging}
              accessibilityRole="button"
              accessibilityLabel={`Log ${pending.minutes} minutes${pending.target === null ? "" : ` to ${pending.target.name}`}`}
              accessibilityState={{ disabled: logging, busy: logging }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.rowPressed]}
            >
              <Text style={styles.primaryLabel}>{logging ? "Logging…" : "Log it"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.micRow}>
        <MicOrb
          status={state.status}
          onPress={handleMicPress}
          size={52}
          accessibilityLabel={
            state.status === "listening" ? "Stop listening" : "Voice control for tracking"
          }
          accessibilityHint={
            state.status === "listening"
              ? undefined
              : "Say start, stop, pause, resume, or start tracking a goal by name"
          }
        />
        <Text
          style={[styles.statusLine, blocked && styles.statusLineBlocked]}
          accessibilityLiveRegion="polite"
          numberOfLines={2}
        >
          {statusLine}
        </Text>
        {state.status === "listening" ? (
          <Pressable
            onPress={() => void cancel()}
            accessibilityRole="button"
            accessibilityLabel="Cancel and discard what you said"
            style={({ pressed }) => [styles.inlineAction, pressed && styles.rowPressed]}
          >
            <Text style={styles.inlineActionLabel}>Cancel</Text>
          </Pressable>
        ) : state.status === "error" ? (
          <Pressable
            onPress={() => {
              setNotice(null);
              reset();
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={({ pressed }) => [styles.inlineAction, pressed && styles.rowPressed]}
          >
            <Text style={styles.inlineActionLabel}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  micRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  statusLine: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    flex: 1,
  },
  statusLineBlocked: {
    color: colors.destructive,
    fontWeight: "600",
  },
  inlineAction: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  inlineActionLabel: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
    textDecorationLine: "underline",
  },
  panel: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  candidateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  candidateName: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  candidateKind: {
    ...typography.label,
    color: colors.mutedForegroundLight,
  },
  panelActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.75,
  },
  secondaryButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  primaryButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.primary,
  },
  primaryLabel: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
