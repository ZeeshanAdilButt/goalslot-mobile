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

import { currentCoachWeekScopeKey, extractCoachProposals, type CoachProposalAction } from "@goalslot/shared";

import { CoachProposalCard } from "@/components/coach/CoachProposalCard";
import { MicOrb } from "@/components/voice/MicOrb";
import { CoachBudgetNotice } from "@/components/settings/CoachBudgetNotice";
import { FormattedText } from "@/components/ui/FormattedText";
import { Icon } from "@/components/ui/Icon";
import { useApplyCoachProposals } from "@/hooks/useApplyCoachProposals";
import { useVoiceCapture, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import { apiClient } from "@/lib/api-client";
import { coachQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors, iconSize, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const RATE_LIMIT_MESSAGE = "You've used today's 30 Coach messages. It resets in 24 hours — try again later.";

/** Shown at rest so the mic isn't a button with no stated vocabulary. */
const EXAMPLES = [
  "Start tracking time for my deen goal",
  "Add a task to call the bank",
  "Move my study block to 7pm",
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
  const nextTurnId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  /** Guards the forwarded transcript so a re-focus can't replay the same command. */
  const forwardedRef = useRef<string | null>(null);

  const removeTurn = useCallback((turnId: number) => {
    setHistory((current) => current.filter((turn) => turn.id !== turnId));
    setDismissedProposals((current) => {
      if (!current.has(turnId)) return current;
      const next = new Map(current);
      next.delete(turnId);
      return next;
    });
  }, []);

  const handleCommand = useCallback(
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
              : err instanceof Error
                ? err.message
                : "Couldn't reach GoalSlot AI. Check your connection and try again.",
        };
      } finally {
        abortRef.current = null;
      }
    },
    [removeTurn, scopeKey],
  );

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
    if (state.status === "processing") return;
    // No history reset here. Starting a new recording is a follow-up turn
    // in the same thread, not a fresh conversation — see the note on
    // `history` above. `handleCommand` appends the new turn once there is
    // a transcript to append; nothing needs to happen to the old ones now.
    void start();
  }, [openSettings, start, state.status, stop]);

  const applyActions = useCallback(
    (actions: CoachProposalAction[]) => apply({ actions }),
    [apply],
  );

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

  // Every turn, parsed once per render — each carries its own reply text,
  // so a turn already on screen from an earlier command never re-parses
  // when a later one streams in.
  const turns = useMemo(
    () =>
      history.map((turn) => {
        const parsed = extractCoachProposals(turn.reply);
        const dismissed = dismissedProposals.get(turn.id) ?? EMPTY_DISMISSED;
        const visibleProposals = parsed.proposals
          .map((block, index) => ({ block, index }))
          .filter(({ index }) => !dismissed.has(index));
        return { turn, parsed, visibleProposals };
      }),
    [dismissedProposals, history],
  );
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
        return !hasAnswer ? "Tap the mic and say what you need" : "Tap the mic to ask something else";
    }
  })();

  const blocked = state.status === "permission-denied" || state.status === "unavailable";

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
        <Text
          style={[styles.statusLine, blocked && styles.statusLineBlocked]}
          accessibilityLiveRegion="polite"
          numberOfLines={3}
        >
          {statusLine}
        </Text>

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
            <Pressable
              onPress={() => void cancel()}
              accessibilityRole="button"
              accessibilityLabel="Cancel and discard what you said"
              style={({ pressed }) => [styles.textAction, pressed && styles.textActionPressed]}
            >
              <Text style={styles.textActionLabel}>Cancel</Text>
            </Pressable>
          ) : null}

          {state.status === "error" ? (
            <Pressable
              onPress={reset}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this message"
              style={({ pressed }) => [styles.textAction, pressed && styles.textActionPressed]}
            >
              <Text style={styles.textActionLabel}>Dismiss</Text>
            </Pressable>
          ) : null}

          {/* Always present, in every state. Voice is an alternative way in,
              never the only one — someone who cannot speak, will not speak
              here, or is on a device with no recognizer gets the identical
              feature one tap away. */}
          <Pressable
            onPress={() => router.push("/coach")}
            accessibilityRole="link"
            accessibilityLabel="Type your request instead, in Coach chat"
            style={({ pressed }) => [styles.textAction, pressed && styles.textActionPressed]}
          >
            <Text style={[styles.textActionLabel, blocked && styles.textActionLabelStrong]}>Type instead</Text>
          </Pressable>
        </View>
      </View>
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
    ...shadows.subtle,
  },
  saidLabel: {
    ...typography.label,
    color: colors.primaryForeground,
    opacity: 0.7,
  },
  saidText: {
    ...typography.body,
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.subtle,
  },
  replyText: {
    ...typography.body,
    color: colors.foreground,
  },
  pendingText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
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
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    minHeight: 40,
  },
  statusLineBlocked: {
    color: colors.destructive,
    fontWeight: "600",
  },
  dockActions: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  textAction: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  textActionPressed: {
    opacity: 0.6,
  },
  textActionLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.mutedForeground,
    textDecorationLine: "underline",
  },
  textActionLabelStrong: {
    color: colors.foreground,
  },
});
