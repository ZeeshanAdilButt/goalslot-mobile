// Coach: GoalSlot's flagship AI feature, previously missing from mobile
// entirely (it shipped on web — dw-time-web/src/features/coach/ — but was
// deferred out of the mobile v1 screen list, which was the wrong call).
// This first mobile pass is chat-only: message thread, streaming reply,
// read-only proposal cards. Deliberately NOT ported in this pass: BYOK key
// management, habits profile, daily check-ins, journal-via-coach, weekly
// narrative, and insights — all real endpoints (see
// dw-time-api/src/modules/coach-*), all with zero mobile UI today, all
// left for a follow-up rather than trying to land the whole web surface at
// once.
//
// Streaming: uses apiClient.coach.streamChat, which goes over `expo/fetch`
// (not the RN built-in `fetch`) specifically because Hermes' fetch can't
// expose a readable response body — see src/lib/api-client.ts's comment.
//
// "Analyze my day": the Coach's system prompt and per-request context bundle
// (recentJournal, recentTimeEntries, scheduleBlocks, activeGoals) are both
// assembled server-side, in the sibling goal-slot-api repo's
// coach-ai.service.ts — not reachable from this repo. That bundle already
// hands the model 14 days of journal + time-entry data, but it has no notion
// of per-day schedule-block completion (scheduleBlocks carries the recurring
// block definitions, never "did this happen today") and does zero pattern
// detection of its own (e.g. "this block is rarely completed", "this goal
// got much more time than usual") — it's raw rows, and spotting a pattern in
// them is left entirely to the model. Rather than guess at a backend change
// this checkout can't make or verify, `buildDayAnalysisBundle` /
// `formatDayAnalysisPrompt` (packages/shared/src/coach/day-analysis.ts)
// compute both client-side from data this app already fetches (schedule,
// time entries, journal) and fold the result into the TEXT of a normal chat
// message sent through the existing POST /coach/chat/:scopeKey path — no API
// contract change required. See handleAnalyzeDay below.
//
// Proposals used to render read-only here, with a footnote telling the user
// to open the web app to apply them. That changed with voice control: the
// voice assistant (app/(app)/voice.tsx) needs the same card and needs it to
// work, and shipping two versions — one actionable and one not — would be
// worse than either. The card moved to
// src/components/coach/CoachProposalCard.tsx, gained an Apply button gated
// on explicit confirmation (twice, for anything destructive), and both
// screens render that one component against POST /coach/proposals/apply.
// So a change the user typed and a change they spoke behave identically,
// because they are the same code.
//
// scopeKey is always "this ISO week" (currentCoachWeekScopeKey()) — web
// also offers month/quarter/year via a scope-period picker, which doesn't
// fit a phone-width chat screen in this pass.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  buildDayAnalysisBundle,
  currentCoachWeekScopeKey,
  describeCoachProposalFailure,
  extractCoachProposals,
  formatDayAnalysisPrompt,
  todayKey,
  type CoachMessageDto,
  type CoachProposalAction,
  type ConversationTurnSnapshot,
  type DayAnalysisTimeEntryInput,
  type TimeEntry,
} from "@goalslot/shared";

import { EmptyState, QueryErrorState } from "@/components";
import { CoachHistorySheet, type CoachHistorySheetRef } from "@/components/coach/CoachHistorySheet";
import { CoachProposalCard } from "@/components/coach/CoachProposalCard";
import { formatMessageTime } from "@/components/messaging/format";
// Deep import, not the `@/components/messaging` barrel: that barrel re-exports
// NewConversationSheet, and Metro doesn't tree-shake unused named exports out
// of an `export *` (see the comment in src/components/index.ts) — pulling it
// through the barrel would drag the whole messaging surface into this screen's
// bundle graph. Same reason `format` above is deep-imported.
import { ThreadSkeleton } from "@/components/messaging/MessagingSkeletons";
import { HiddenTabBackButton, useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { CoachBudgetNotice } from "@/components/settings/CoachBudgetNotice";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormattedText, toPlainText } from "@/components/ui/FormattedText";
import { Icon } from "@/components/ui/Icon";
import { TypingIndicator } from "@/components/ui/TypingIndicator";
import { MicOrb } from "@/components/voice/MicOrb";
import { useApplyCoachProposals } from "@/hooks/useApplyCoachProposals";
import { useScreenView } from "@/hooks/useScreenView";
import { useVoiceCapture, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import { apiClient } from "@/lib/api-client";
import { coachChatQuery } from "@/lib/coach-chat-query";
import { archiveConversation, markLiveConversationReset, recordConversationActivity } from "@/lib/coach-history-store";
import { canStartNewChat as canStartNewChatFn } from "@/lib/new-chat-availability";
import { htmlToPlainText } from "@/lib/note-content";
import { coachQueries, journalQueries, scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useCapabilities } from "@/providers/capabilities-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_MESSAGE = "You've used today's 30 Coach messages. It resets in 24 hours — try again later.";

/**
 * Shown instead of a raw network exception when `streamChat` never gets a
 * response at all. See the matching constant + comment in
 * app/(app)/voice.tsx's `runCoachTurn` for the full "why `.status` is the
 * right signal here" reasoning — postCoachStream only attaches `.status`
 * once a real HTTP response came back.
 */
const OFFLINE_MESSAGE =
  "You're offline — Coach needs an internet connection. Try again once you're back online.";

/** How many days of prior time entries "Analyze my day" pulls to compute block-completion history and per-goal daily averages. */
const DAY_ANALYSIS_TRAILING_WINDOW_DAYS = 28;

/** Local YYYY-MM-DD arithmetic, same shape as journal.tsx's own `addDays` — kept local rather than shared since it's a two-line date helper, not a domain concept. */
function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + deltaDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Appends a dictated phrase onto whatever's already in the composer, with a
 * single separating space — same shape as journal.tsx's own
 * `appendDictatedPhrase` (kept local rather than shared for the same reason
 * `shiftDateKey` above is: a two-line string helper, not a domain concept).
 * Append rather than replace so a second dictation on top of typed text, or
 * on top of an earlier dictation, adds to it instead of clobbering it.
 */
function appendDictatedPhrase(existing: string, phrase: string): string {
  const trimmedPhrase = phrase.trim();
  if (trimmedPhrase.length === 0) return existing;
  if (existing.length === 0) return trimmedPhrase;
  return /\s$/.test(existing) ? `${existing}${trimmedPhrase}` : `${existing} ${trimmedPhrase}`;
}

function toDayAnalysisEntry(entry: TimeEntry): DayAnalysisTimeEntryInput {
  return {
    id: entry.id,
    taskName: entry.taskName,
    duration: entry.duration,
    date: entry.date,
    scheduleBlockId: entry.scheduleBlockId,
    goalId: entry.goalId,
    goalTitle: entry.goal?.title,
  };
}

interface ChatMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  pending?: boolean;
  /**
   * Absent for an optimistic/streaming message (there's nothing to persist
   * yet); present once the history refetch lands the real, server-timestamped
   * row. Deliberately not backfilled with `Date.now()` in the meantime — a
   * clock reading under a bubble that hasn't actually round-tripped to the
   * server would be a small lie, and the bubble reads fine with none.
   */
  createdAt?: string;
}

/**
 * The user message an assistant bubble at `index` was answering — what the
 * "Ask again" affordance on an unpreparable proposal re-sends. Returns a
 * plain string so ChatBubble's memo still sees a stable prop.
 */
function precedingUserContent(messages: readonly ChatMessageView[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate?.role === "USER") return candidate.content;
  }
  return undefined;
}

// Memoised: `allMessages` is rebuilt every time `streamingReply` changes —
// i.e. on every SSE chunk while a reply is streaming in — which otherwise
// re-rendered every bubble already on screen (each one re-running
// `extractCoachProposals`'s regex/JSON parse below, plus a proposal card's
// own cache scan) on every token of an unrelated, still-arriving message.
// `message` keeps a stable object reference for any bubble that isn't the one
// currently streaming, so this only lets the live bubble re-render per chunk.
const ChatBubble = memo(function ChatBubble({
  message,
  onApply,
  retryContent,
  onRetry,
}: {
  message: ChatMessageView;
  /** Omitted while a reply is still streaming — half a proposal isn't a proposal. */
  onApply?: (actions: CoachProposalAction[]) => Promise<string>;
  /**
   * The user message this reply answered, so a reply whose proposal couldn't
   * be prepared can offer to re-ask it. A plain string (not a closure) so the
   * memo above still sees a stable prop for every bubble that isn't the one
   * currently streaming.
   */
  retryContent?: string;
  onRetry?: (content: string) => void;
}) {
  const isUser = message.role === "USER";
  // Clock-time only ("9:05 AM"), the same helper and treatment
  // src/components/messaging/MessageBubble.tsx uses under its own bubbles —
  // this is metadata, present but visually subordinate, not a second line of
  // content competing with the message.
  const time = message.createdAt ? formatMessageTime(message.createdAt) : "";

  if (isUser) {
    return (
      <View style={styles.messageRow}>
        <View
          style={[styles.bubble, styles.bubbleUser]}
          accessible
          accessibilityLabel={`You said: ${message.content}${time ? ` at ${time}.` : ""}`}
        >
          <Text style={styles.bubbleTextUser}>{message.content}</Text>
        </View>
        {time ? (
          <Text
            style={styles.timestamp}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {time}
          </Text>
        ) : null}
      </View>
    );
  }

  const {
    cleaned,
    proposals,
    pending: proposalPending,
    unrenderable: proposalUnrenderable,
  } = extractCoachProposals(message.content || "");
  const showTypingOnly = message.pending && !cleaned && !proposalPending && proposals.length === 0;

  return (
    <View style={[styles.messageRow, styles.messageRowAssistant]}>
      <Text style={styles.roleLabel}>Coach</Text>
      <View
        style={[styles.bubble, styles.bubbleAssistant]}
        accessible={!showTypingOnly}
        // `toPlainText`, not the raw content: the reply is markdown, and a
        // screen reader given it verbatim announces "hash hash hash What
        // Worked colon" / "star star bold star star" — the same bug sighted
        // users hit, just in audio.
        accessibilityLabel={
          showTypingOnly ? undefined : `Coach replied: ${toPlainText(cleaned)}${time ? ` at ${time}.` : ""}`
        }
      >
        {showTypingOnly ? (
          <View
            style={styles.typingIndicator}
            accessibilityLabel="Coach is typing"
            accessibilityLiveRegion="polite"
          >
            <TypingIndicator />
          </View>
        ) : (
          <>
            {cleaned ? <FormattedText text={cleaned} style={styles.bubbleTextAssistant} /> : null}
            {message.pending && !proposalPending ? <Text style={styles.streamingCursor}>▍</Text> : null}
          </>
        )}
      </View>
      {!showTypingOnly && time ? (
        <Text
          style={styles.timestamp}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {time}
        </Text>
      ) : null}
      {proposalPending ? (
        <View style={styles.proposalPending} accessibilityLabel="Coach is preparing a proposed change">
          <Text style={styles.proposalPendingText}>Preparing a proposed change…</Text>
        </View>
      ) : null}
      {/* The copy names WHICH of the four ways the block failed (see
          describeCoachProposalFailure). It used to be one sentence —
          "Something went wrong preparing that change" — standing in for all
          of them, including a parse error that a bare `catch {}` had already
          thrown away, which is how a live failure ended up undiagnosable. */}
      {!message.pending && !proposalPending && proposalUnrenderable ? (
        <View
          style={styles.proposalUnrenderable}
          accessibilityRole="alert"
          accessibilityLabel="Coach couldn't prepare that change"
        >
          <Text style={styles.proposalUnrenderableText}>
            {describeCoachProposalFailure(proposalUnrenderable)}
          </Text>
          {onRetry && retryContent ? (
            <Pressable
              onPress={() => onRetry(retryContent)}
              accessibilityRole="button"
              accessibilityLabel="Ask again"
              accessibilityHint="Sends your previous message to the Coach again"
              style={({ pressed }) => [styles.proposalRetryButton, pressed && styles.proposalRetryPressed]}
            >
              <Text style={styles.proposalRetryLabel}>Ask again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {proposals.map((block, idx) => (
        <View key={idx} style={styles.proposalSlot}>
          <CoachProposalCard block={block} onApply={onApply} />
        </View>
      ))}
    </View>
  );
});

export default function CoachScreen() {
  const analytics = useAnalytics();
  // Normally "this ISO week" — but a row tapped in CoachHistorySheet for a
  // past, still-live week arrives here as a `scopeKey` route param, and this
  // screen has to show THAT conversation instead. `defaultScopeKey` is kept
  // separately so `isReadOnly` below (and the "back to current week" logic
  // in the history sheet) can tell "the current week" apart from "whatever
  // scopeKey happens to be showing".
  const defaultScopeKey = useMemo(() => currentCoachWeekScopeKey(), []);
  const { scopeKey: scopeKeyParam } = useLocalSearchParams<{ scopeKey?: string }>();
  const scopeKey =
    typeof scopeKeyParam === "string" && scopeKeyParam.length > 0 ? scopeKeyParam : defaultScopeKey;
  // A past week's conversation is still a real, fetchable server
  // conversation — posting into it is technically accepted by the backend.
  // It's read-only anyway: `hoursByGoalThisWeek`/`weekReflections` in the
  // Coach's per-request context bundle are computed for THIS week, so a
  // message sent against an old scopeKey would silently reason about today's
  // schedule using a stale week's numbers. Hiding the composer avoids that
  // trap rather than exposing it with a caveat.
  const isReadOnly = scopeKey !== defaultScopeKey;
  const { apply } = useApplyCoachProposals();
  const historySheetRef = useRef<CoachHistorySheetRef>(null);

  const applyActions = useCallback(
    (actions: CoachProposalAction[]) => apply({ actions }),
    [apply],
  );

  const openHistory = useCallback(() => {
    // The composer's TextInput can be focused (keyboard up) when this fires
    // — CoachHistorySheet has no input of its own, so nothing else tells the
    // keyboard to lower, and it was rendering the sheet underneath it.
    Keyboard.dismiss();
    historySheetRef.current?.present();
  }, []);

  useScreenView("coach");

  // This route is a hidden Tabs.Screen (see app/(app)/_layout.tsx), not a
  // pushed stack entry, so the OS back gesture/button doesn't reliably
  // return to wherever Coach was opened from — it was landing on the Today
  // dashboard instead. Voice is the primary, constantly-used entry ("Type
  // instead" chip); Settings' "Open Coach" row is a second, undistinguishable
  // origin — accepted limitation, same as notification-settings.tsx documents
  // for its own second entry point. See HiddenTabBackButton.tsx.
  useHiddenTabBackHandler("/voice");

  // Options live in src/lib/coach-chat-query.ts — see that file for why this
  // one query opts out of the global `keepPreviousData` default, which was
  // leaving the PREVIOUS conversation on screen (with `isPending` false, so
  // the skeleton below never fired) for the whole duration of a chat switch.
  const historyQuery = useQuery(coachChatQuery(scopeKey));

  const [input, setInput] = useState("");
  // Same focus-ring treatment as journal.tsx's editor (`isEditorFocused` /
  // `textInputFocused`) — a plain hairline border reads identically focused
  // or not, which is exactly the "doesn't feel considered" complaint the
  // composer had. Local to the composer only; nothing else on this screen
  // needs it.
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [optimisticUser, setOptimisticUser] = useState<ChatMessageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const { voice } = useCapabilities();

  /**
   * The composer's mic — dictate a message instead of typing it.
   *
   * PRODUCT DECISION: this does NOT get voice.tsx's three-tier fast-path
   * routing (local pattern match -> Tier 2 /coach/voice-intent classifier ->
   * full Coach chat — see that screen's `handleCommand`). Plain
   * dictate-into-composer only. Why:
   *
   * - Every other way this screen sends anything goes through an explicit
   *   Send press first — even "Analyze my day" puts its assembled prompt
   *   back in the input on failure rather than silently retrying (see
   *   `sendCoachMessage`'s `onFailure`). A fast-path command like "stop the
   *   timer" executing instantly, with no message ever appearing in this
   *   thread, would break that contract: an action would happen that
   *   nothing on screen shows happening, on a screen that is nothing BUT a
   *   record of what was said and sent. That is more surprising here than
   *   plain dictation is, not less.
   * - The fast-path's own UI — the "which one did you mean" and "log 12
   *   minutes?" confirmation panels voice.tsx renders in its dock — has
   *   nowhere to live in this screen's single-row composer without
   *   reproducing voice.tsx's dedicated layout here too.
   * - The instant-command experience already has a home one tab away (the
   *   Voice tab), which this composer's mic deliberately does not try to
   *   duplicate. This button's job is narrower: let someone who already
   *   opened Coach to type also just speak the words instead, exactly like
   *   journal.tsx's dictation-into-draft mic does for a journal entry.
   *
   * `onCommand` always returns 'handoff', never 'done' — the words landed in
   * the input, not in a sent message, so there is nothing for the hook's own
   * success tick to confirm; the user still has to review and press Send.
   */
  const handleVoiceCommand = useCallback(async (transcript: string): Promise<VoiceCommandOutcome> => {
    setInput((prev) => appendDictatedPhrase(prev, transcript));
    return { kind: "handoff" };
  }, []);

  const {
    state: voiceState,
    start: startVoice,
    stop: stopVoice,
    openSettings: openVoiceSettings,
  } = useVoiceCapture({ voice, onCommand: handleVoiceCommand, label: "Coach dictation" });

  const persistedMessages = useMemo<ChatMessageView[]>(() => {
    return (historyQuery.data ?? [])
      .filter((m: CoachMessageDto) => m.role === "USER" || m.role === "ASSISTANT")
      .map((m: CoachMessageDto) => ({
        id: m.id,
        role: m.role as "USER" | "ASSISTANT",
        content: m.content,
        createdAt: m.createdAt,
      }));
  }, [historyQuery.data]);

  const allMessages = useMemo<ChatMessageView[]>(() => {
    const list = [...persistedMessages];
    if (optimisticUser) list.push(optimisticUser);
    if (streaming) {
      list.push({ id: "streaming-assistant", role: "ASSISTANT", content: streamingReply, pending: true });
    }
    return list;
  }, [persistedMessages, optimisticUser, streaming, streamingReply]);

  // "New chat" confirmation state — see voice.tsx's identical dialog and
  // `src/components/ui/ConfirmDialog.tsx`'s header for why this is a themed
  // modal rather than `Alert.alert`. Both screens clear the exact same
  // server-side conversation, so they share the one component rather than
  // each styling their own version of the same yes/no question.
  const [newChatConfirmVisible, setNewChatConfirmVisible] = useState(false);
  const [newChatBusy, setNewChatBusy] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);

  /**
   * One predicate for BOTH the "+" button's visibility and its handler — see
   * src/lib/new-chat-availability.ts for the four states in which those two
   * used to disagree, leaving a fully-styled, accessibility-labelled button
   * that did nothing at all when pressed.
   *
   * `persistedMessages`, deliberately NOT `allMessages`: "New chat" archives
   * the persisted turns and then issues the destructive server-side clear.
   * Mid-way through the first send the screen shows an optimistic bubble and
   * a streaming reply, but there is nothing persisted for either half of that
   * to act on, and the server writes the USER row at the start of the stream
   * and the ASSISTANT row at the end — so a clear issued between those two
   * would be raced by the reply landing back in the "new" conversation. For
   * every message after the first this is true throughout the stream, so the
   * button does not flicker in normal use; it is only absent before the very
   * first reply has been persisted, which is exactly when it has no work.
   */
  const canStartNewChat = useMemo(
    () => canStartNewChatFn({ messageCount: persistedMessages.length, isReadOnly }),
    [persistedMessages.length, isReadOnly],
  );

  /**
   * "New chat": unavoidably destructive server-side (one conversation per
   * user+scopeKey, no thread ids to spin a fresh one up under — see the
   * module header). The confirm copy says so plainly.
   */
  const handleNewChat = useCallback(() => {
    // Same predicate the header render below uses — see `canStartNewChat`.
    // Kept as a defensive guard even though the button is now hidden when it
    // is false, because this also fires from a press that was already in
    // flight when the last message went away.
    if (!canStartNewChat) return;
    setNewChatError(null);
    setNewChatConfirmVisible(true);
  }, [canStartNewChat]);

  const cancelNewChat = useCallback(() => {
    if (newChatBusy) return;
    setNewChatConfirmVisible(false);
    setNewChatError(null);
  }, [newChatBusy]);

  /**
   * Snapshot -> server clear -> local reset, in that order: the snapshot is
   * cheap and purely local, so taking it unconditionally before the clear
   * (rather than after) means a failed clear never leaves the conversation
   * half-archived.
   */
  const confirmNewChat = useCallback(() => {
    if (newChatBusy) return;
    setNewChatBusy(true);
    setNewChatError(null);
    void (async () => {
      // EVERYTHING is inside try/finally, and `setNewChatBusy(false)` lives
      // in the finally, because a stuck `newChatBusy` is unrecoverable
      // without force-quitting the app: ConfirmDialog neuters
      // `onRequestClose` (Android hardware back), drops the backdrop's
      // `onPress`, and disables Cancel while `busy`, and Button treats
      // `loading` as disabled — so every single exit from the dialog is
      // closed. That is a worse failure than whatever caused it.
      try {
        const snapshot: ConversationTurnSnapshot[] = persistedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        // Matches voice.tsx: never archive an empty conversation. Reachable
        // if the thread is refetched away (cleared on another device) while
        // this dialog is open — without the guard that writes a blank entry
        // into Previous chats.
        if (snapshot.length > 0) {
          await archiveConversation(scopeKey, snapshot);
        }
        try {
          await apiClient.coach.clearChatHistory(scopeKey);
        } catch {
          // The server still has the old conversation — leave the screen
          // as-is rather than pretending the clear happened. The snapshot
          // just taken is harmless: it'll sit in Previous chats as an extra
          // copy if the user retries and succeeds. Distinct from the outer
          // catch only in that this one is expected; both leave the dialog
          // open with an inline error, which is what it is for.
          setNewChatError("Couldn't start a new chat. Please try again.");
          return;
        }
        setOptimisticUser(null);
        setError(null);
        await queryClient.invalidateQueries({ queryKey: coachQueries.coachQueries.chat(scopeKey) });
        void markLiveConversationReset(scopeKey);
        setNewChatConfirmVisible(false);
      } catch {
        setNewChatError("Couldn't start a new chat. Please try again.");
      } finally {
        setNewChatBusy(false);
      }
    })();
  }, [newChatBusy, persistedMessages, scopeKey]);

  /**
   * Core send/stream/persist flow, shared by the composer's Send button and
   * the "Analyze my day" quick action below — both post a piece of text as
   * the next USER turn through the same `apiClient.coach.streamChat`; only
   * where that text comes from differs. `onFailure` lets each caller decide
   * what "give the user their text back to retry" means for it (the
   * composer restores it into the input box; day-analysis does the same so
   * the existing CoachBudgetNotice retry button keeps working unmodified).
   * Returns whether the message was sent and a reply persisted successfully.
   */
  const sendCoachMessage = useCallback(
    async (content: string, onFailure?: (content: string) => void): Promise<boolean> => {
      // Defence in depth: the composer and "Analyze my day" are both hidden
      // while `isReadOnly`, so this shouldn't be reachable, but a post
      // against a past week's scopeKey is exactly the date-context mix-up
      // this screen exists to avoid — worth refusing outright rather than
      // trusting the UI alone to prevent it.
      if (isReadOnly) return false;
      setError(null);
      const userMsgId = `local_user_${Date.now()}`;
      setOptimisticUser({ id: userMsgId, role: "USER", content });
      setStreamingReply("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let success = false;
      try {
        const iter = await apiClient.coach.streamChat(scopeKey, content, { signal: controller.signal });
        let acc = "";
        let streamErr: string | undefined;
        for await (const chunk of iter) {
          if (chunk.delta) {
            acc += chunk.delta;
            setStreamingReply(acc);
          }
          if (chunk.error) streamErr = chunk.error;
          if (chunk.done) break;
        }
        if (streamErr) {
          setError(streamErr);
          onFailure?.(content);
          setOptimisticUser(null);
        } else {
          await queryClient.invalidateQueries({ queryKey: coachQueries.coachQueries.chat(scopeKey) });
          setOptimisticUser(null);
          success = true;
          // The only signal that gets this scopeKey recorded as a
          // "Previous chats" entry — see coach-history-store.ts's header for
          // why there's no server endpoint to discover it from otherwise.
          // Fire-and-forget: a lost write costs a stale preview line, not a
          // functional failure.
          void recordConversationActivity(scopeKey, acc || content);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Explicit Stop — not a failure, leave the thread as-is.
          return false;
        }
        const status = (err as { status?: number } | undefined)?.status;
        const message =
          status === 429
            ? RATE_LIMIT_MESSAGE
            : status !== undefined && err instanceof Error
              ? err.message
              : OFFLINE_MESSAGE;
        setError(message);
        onFailure?.(content);
        setOptimisticUser(null);
      } finally {
        setStreaming(false);
        setStreamingReply("");
        abortRef.current = null;
      }
      return success;
    },
    [isReadOnly, scopeKey],
  );

  /** Stable across renders so ChatBubble's memo isn't defeated by a fresh
   *  closure on every SSE chunk. */
  const retrySend = useCallback(
    (content: string) => {
      if (streaming) return;
      void sendCoachMessage(content);
    },
    [sendCoachMessage, streaming],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput("");
    await sendCoachMessage(trimmed, (content) => setInput((cur) => cur || content));
  }, [input, streaming, sendCoachMessage]);

  const [analyzingDay, setAnalyzingDay] = useState(false);

  /**
   * "Analyze my day": gathers today's schedule, tracked time, and journal
   * entry client-side (see the header comment on why this can't be a
   * backend prompt change from this repo), turns it into one well-formed
   * prompt, and sends it exactly like a typed message. See
   * packages/shared/src/coach/day-analysis.ts for the assembly + pattern
   * detection (block completion history, goal-time-vs-usual).
   */
  const handleAnalyzeDay = useCallback(async () => {
    if (streaming || analyzingDay) return;
    setAnalyzingDay(true);
    setError(null);
    try {
      const dateKey = todayKey();
      const dayOfWeek = new Date().getDay();
      const trailingEnd = shiftDateKey(dateKey, -1);
      const trailingStart = shiftDateKey(dateKey, -DAY_ANALYSIS_TRAILING_WINDOW_DAYS);

      const [weekSchedule, todayEntriesRes, trailingEntriesRes, journalEntry] = await Promise.all([
        queryClient.fetchQuery(scheduleQueries.weekly()),
        apiClient.timeEntries.getByDateRange(dateKey, dateKey),
        apiClient.timeEntries.getByDateRange(trailingStart, trailingEnd),
        journalQueries.fetchEntryByDate(dateKey),
      ]);

      const scheduleBlocksForDay = (weekSchedule[dayOfWeek] ?? []).map((block) => ({
        id: block.id,
        title: block.title,
        category: block.category,
        dayOfWeek: block.dayOfWeek,
        startTime: block.startTime,
        endTime: block.endTime,
        goalId: block.goalId,
        goalTitle: block.goal?.title,
      }));

      const bundle = buildDayAnalysisBundle({
        dateKey,
        scheduleBlocksForDay,
        timeEntriesForDay: todayEntriesRes.data.map(toDayAnalysisEntry),
        trailingTimeEntries: trailingEntriesRes.data.map(toDayAnalysisEntry),
        trailingWindowDays: DAY_ANALYSIS_TRAILING_WINDOW_DAYS,
        // Flattened, not raw: this prompt is echoed back as the user's own
        // chat bubble (and its accessibilityLabel), so raw TipTap markup would
        // be visible there and re-read on every reload of the conversation.
        // The builder treats "" exactly as it treats null, so a wordless entry
        // still lands in the "no journal entry" branch.
        journalContent: htmlToPlainText(journalEntry?.content ?? ""),
      });
      const prompt = formatDayAnalysisPrompt(bundle);

      analytics.track({ name: "coachDayAnalysisRequested", payload: { date: dateKey } });
      await sendCoachMessage(prompt, (content) => setInput((cur) => cur || content));
    } catch {
      setError("Couldn't gather today's data to analyze. Please try again.");
    } finally {
      setAnalyzingDay(false);
    }
  }, [analytics, analyzingDay, sendCoachMessage, streaming]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  /**
   * Mirrors TrackerVoiceButton's own `handleMicPress` exactly: a listening
   * mic is stopped (commits whatever it heard), a denied one jumps straight
   * to Settings instead of re-prompting (the OS never shows that dialog
   * twice), and a mid-reply screen refuses to open the mic at all — the
   * composer is already `editable={false}` while `streaming`, so starting a
   * dictation that has nowhere visible to land would be worse than just
   * disabling the button.
   */
  const handleMicPress = useCallback(() => {
    if (voiceState.status === "listening") {
      void stopVoice();
      return;
    }
    if (voiceState.status === "permission-denied") {
      openVoiceSettings();
      return;
    }
    if (voiceState.status === "processing" || streaming) return;
    void startVoice();
  }, [openVoiceSettings, startVoice, stopVoice, streaming, voiceState.status]);

  const voiceBlocked = voiceState.status === "permission-denied" || voiceState.status === "unavailable";
  // Only worth a caption while there's something to say beyond "idle, ready
  // to tap" — 'processing' is skipped too: `handleVoiceCommand` above is
  // synchronous (no network call), so that state never lingers long enough
  // for a line of text to be worth rendering before it flips back to idle.
  const voiceStatusLine =
    voiceState.status === "listening"
      ? voiceState.transcript.length > 0
        ? voiceState.transcript
        : "Listening…"
      : voiceState.status === "error" || voiceBlocked
        ? voiceState.message
        : null;

  useEffect(() => {
    // Auto-scroll to the newest message as the thread grows or a reply streams in.
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [allMessages.length, streamingReply]);

  let body: React.ReactNode;
  if (historyQuery.isPending) {
    // The shared thread placeholder, not a hand-rolled one: it carries
    // `accessibilityRole="progressbar"` (which the local version lacked, so a
    // screen reader announced nothing while a chat loaded) and bottom-anchors
    // its bubbles, which is right for a thread that fills from the bottom.
    body = <ThreadSkeleton />;
  } else if (historyQuery.isError && !historyQuery.data) {
    // `isError && !data`, matching goals.tsx/tasks.tsx/schedule.tsx's own
    // guard: `refetchOnMount: "always"` above means this refetches on every
    // visit, so a failed background refetch must not replace an
    // already-loaded thread with a hard error.
    body = (
      <QueryErrorState
        error={historyQuery.error}
        message="Couldn't load your conversation with the Coach."
        onRetry={() => void historyQuery.refetch()}
      />
    );
  } else if (allMessages.length === 0) {
    body = (
      <EmptyState
        message="Ask the Coach anything about your goals, schedule, or how your week is going — it reads your real GoalSlot data to answer."
      />
    );
  } else {
    body = (
      <ScrollView
        // Keyed on the conversation: switching to an already-cached scopeKey
        // renders no skeleton in between, so without this the ScrollView is
        // reused and keeps the previous thread's scroll offset. The
        // auto-scroll effect above can't recover it either — it depends on
        // `allMessages.length`, which doesn't change when two conversations
        // happen to have the same message count.
        key={scopeKey}
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="none"
      >
        {allMessages.map((m, index) => (
          // A still-streaming reply gets no Apply button: `extractCoachProposals`
          // reports a half-arrived block as `pending`, and offering to apply
          // what has landed so far would let the user agree to a fragment.
          <ChatBubble
            key={m.id}
            message={m}
            onApply={m.pending ? undefined : applyActions}
            retryContent={isReadOnly ? undefined : precedingUserContent(allMessages, index)}
            onRetry={retrySend}
          />
        ))}
      </ScrollView>
    );
  }

  const canSend = input.trim().length > 0 && input.length <= MAX_MESSAGE_LENGTH && !streaming;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <HiddenTabBackButton label="Voice" destination="/voice" />
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Coach
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={openHistory}
            accessibilityRole="button"
            accessibilityLabel="Previous chats"
            accessibilityHint="Browse and reopen earlier conversations with the Coach"
            style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
            hitSlop={8}
          >
            <Icon name="inbox" size={20} color={colors.foreground} />
          </Pressable>
          {/* Gated on the SAME `canStartNewChat` the handler checks, never on
              a looser condition — see src/lib/new-chat-availability.ts. Hidden
              (voice.tsx's precedent) rather than disabled: a dimmed "+" on an
              empty conversation invites the same "why doesn't this work"
              question a dead one does. */}
          {canStartNewChat ? (
            <Pressable
              onPress={handleNewChat}
              accessibilityRole="button"
              accessibilityLabel="Start a new chat"
              accessibilityHint="Clears the assistant's memory of this conversation, after asking to confirm"
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
              hitSlop={8}
            >
              <Icon name="add" size={20} color={colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isReadOnly ? (
        <View style={styles.readOnlyBanner}>
          <Icon name="alert" size={14} color={colors.mutedForeground} />
          <Text style={styles.readOnlyBannerText}>Viewing an earlier week — read-only</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        // Android does NOT resize the window for the keyboard under
        // edge-to-edge (on unconditionally past SDK 35) — "height" is what
        // actually moves the composer above the keyboard here.
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.bodyArea}>{body}</View>

        {error ? (
          <View>
            <Text style={styles.errorBanner} accessibilityRole="alert">
              {error}
            </Text>
            {/* Renders itself only when this failure IS "monthly token budget
                exceeded" — every other error still gets the bare banner it
                always got. `onRetry` re-sends: `handleSend` puts the text back
                in the composer when a send fails, so the message the budget
                ate is still there to send again once the cap goes up. */}
            <CoachBudgetNotice
              error={error}
              onRetry={() => void handleSend()}
              style={styles.budgetNotice}
            />
          </View>
        ) : null}

        {/* No composer, no quick actions, while viewing a past week
            read-only — see `isReadOnly`'s own comment above for why posting
            here isn't just hidden but actively refused in sendCoachMessage
            too. */}
        {!isReadOnly ? (
          <>
            <View style={styles.quickActions}>
              <Pressable
                style={[styles.analyzeDayButton, (streaming || analyzingDay) && styles.analyzeDayButtonDisabled]}
                onPress={() => void handleAnalyzeDay()}
                disabled={streaming || analyzingDay}
                accessibilityRole="button"
                accessibilityLabel="Analyze my day"
                accessibilityHint="Sends today's schedule, tracked time, and journal entry to the Coach for a reflection"
                accessibilityState={{ disabled: streaming || analyzingDay, busy: analyzingDay }}
                hitSlop={8}
              >
                <Text style={styles.analyzeDayButtonText}>{analyzingDay ? "Gathering today's data…" : "Analyze my day"}</Text>
              </Pressable>
            </View>

            {/* Live transcript while listening, or the hook's own
                permission-denied/unavailable/error message — same three
                states journal.tsx's and TrackerVoiceButton's mics surface,
                just spoken here as a caption above the row instead of a
                separate panel, since this composer has no room for one. */}
            {voiceStatusLine ? (
              <Text
                style={[styles.voiceStatusLine, voiceBlocked && styles.voiceStatusLineBlocked]}
                accessibilityLiveRegion="polite"
                numberOfLines={2}
              >
                {voiceStatusLine}
              </Text>
            ) : null}

            <View style={styles.composer}>
              <MicOrb
                status={voiceState.status}
                onPress={handleMicPress}
                disabled={streaming}
                // Matches the Send/Stop buttons' own 44pt so the row reads as
                // three peers, not a smaller decoration bolted beside them.
                size={44}
                accessibilityLabel={
                  voiceState.status === "listening"
                    ? "Stop dictating"
                    : voiceState.status === "permission-denied"
                      ? "Open Settings to allow microphone access"
                      : "Dictate your message"
                }
                accessibilityHint={
                  voiceState.status === "listening"
                    ? undefined
                    : "Speaks your message into the text field below instead of typing it"
                }
              />
              <TextInput
                style={[styles.textInput, isComposerFocused && styles.textInputFocused]}
                value={input}
                onChangeText={setInput}
                onFocus={() => setIsComposerFocused(true)}
                onBlur={() => setIsComposerFocused(false)}
                placeholder="Ask the Coach a question…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={MAX_MESSAGE_LENGTH}
                editable={!streaming}
                accessibilityLabel="Message to the Coach"
                accessibilityHint="Ask about your goals, schedule, or week. Maximum 2000 characters."
              />
              {streaming ? (
                <Pressable
                  style={styles.stopButton}
                  onPress={handleStop}
                  accessibilityRole="button"
                  accessibilityLabel="Stop the Coach's reply"
                  hitSlop={8}
                >
                  <Text style={styles.stopButtonText}>Stop</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
                  onPress={() => void handleSend()}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{ disabled: !canSend }}
                  hitSlop={8}
                >
                  <Text style={styles.sendButtonText}>Send</Text>
                </Pressable>
              )}
            </View>
          </>
        ) : null}
      </KeyboardAvoidingView>

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

      {/* `activeScopeKey` is what stops the sheet offering this screen's own
          conversation as somewhere to navigate to — tapping it did nothing
          visible. Voice mounts the same sheet without it, because Voice is
          never showing a thread for a particular scopeKey. */}
      <CoachHistorySheet ref={historySheetRef} activeScopeKey={scopeKey} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    // Clears the floating hamburger the app layout parks at top-right (see
    // voice.tsx's identical comment on its own header) — now that this
    // header has its own right-aligned buttons, they'd otherwise sit
    // directly under it.
    paddingRight: 64,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.foreground,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  headerButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  headerButtonPressed: {
    backgroundColor: colors.secondary,
  },
  readOnlyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.secondary,
  },
  readOnlyBannerText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  bodyArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  messageRow: {
    alignItems: "flex-end",
    gap: spacing.xxs,
  },
  messageRowAssistant: {
    alignItems: "flex-start",
  },
  roleLabel: {
    ...typography.label,
    color: colors.mutedForeground,
    marginLeft: spacing.xs,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: radii.lg,
    // A step up from the DM thread's own bubble padding (spacing.sm/md —
    // see MessageBubble.tsx), because this bubble routinely holds several
    // sentences of prose rather than a short text; the same reasoning as the
    // font-size bump just below.
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radii.sm,
  },
  bubbleAssistant: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderBottomLeftRadius: radii.sm,
  },
  // `typography.body` (14/20) is the shared scale's UI-row size — right for a
  // list row or a short DM bubble (MessageBubble.tsx intentionally keeps
  // that size), wrong for what this bubble actually holds: multi-sentence,
  // often multi-paragraph replies the user has to read closely to act on.
  // Same fix, same reasoning journal.tsx already applied to its own prose
  // editor (see that file's `textInput` comment): a step up in size, with an
  // explicit lineHeight tuned to it rather than inherited, and letterSpacing
  // nudged tighter as foundation.ts's own scale does for every larger step.
  bubbleTextUser: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.1,
    color: colors.primaryForeground,
  },
  bubbleTextAssistant: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.1,
    color: colors.foreground,
  },
  streamingCursor: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.mutedForeground,
  },
  // Clock time under a bubble — present, but never competing with the
  // message. Same shape as MessageBubble.tsx's own `meta`: caption's size
  // without caption's uppercase eyebrow treatment, which would make a plain
  // "9:05 AM" read as a label instead of a timestamp.
  timestamp: {
    ...typography.caption,
    fontWeight: "400",
    textTransform: "none",
    color: colors.mutedForegroundLight,
  },
  typingIndicator: {
    paddingVertical: spacing.xxs,
  },
  proposalPending: {
    marginTop: spacing.xs,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primaryDark,
    backgroundColor: colors.warningMuted,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  proposalPendingText: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  // Shown instead of a proposal card when the assistant's text claims it
  // prepared a change but `extractCoachProposals` couldn't turn the
  // ```coach-proposal block into anything renderable (malformed JSON, or
  // every action's type unrecognized — e.g. a journal-entry request, which
  // has no proposal action type at all). Without this, that failure was
  // silent: the block vanished and the user was left with prose claiming
  // something happened and no card to show for it.
  proposalUnrenderable: {
    marginTop: spacing.xs,
    gap: spacing.xs,
    alignItems: "flex-start",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  proposalUnrenderableText: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
  // Some malformed blocks are genuinely unrecoverable (see escapeStrayQuotes'
  // KNOWN LIMIT in packages/shared/src/coach/proposals.ts), and re-asking is
  // what actually works — so it is a control, not advice inside a sentence.
  proposalRetryButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  proposalRetryPressed: {
    opacity: 0.7,
  },
  proposalRetryLabel: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.destructive,
  },
  // The proposal card itself now lives in
  // src/components/coach/CoachProposalCard.tsx so the voice assistant renders
  // the identical confirmation. This wrapper only holds the width and inset
  // that make it sit inside the assistant bubble column.
  proposalSlot: {
    maxWidth: "92%",
    alignSelf: "stretch",
  },
  errorBanner: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  budgetNotice: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  quickActions: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    backgroundColor: colors.background,
  },
  analyzeDayButton: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouchTarget,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  analyzeDayButtonDisabled: {
    opacity: 0.5,
  },
  analyzeDayButtonText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    // Matches the bubble text's own size (see bubbleTextAssistant above) so
    // what the user is typing previews at the same size it'll read back at,
    // with its own lineHeight since RN won't derive one for a multiline field.
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.1,
    color: colors.foreground,
  },
  // A plain hairline border reads identically focused or not — no cue that
  // the box is "live" and ready for text. Same ring-on-focus journal.tsx's
  // editor uses (`textInputFocused`). Elevation is `subtle`, not journal's
  // `raised`: foundation.ts's own elevation ramp names `subtle` for "a
  // control seated on a surface (button, input)" and reserves `raised` for a
  // surface floating over other content — journal's editor IS the page's
  // main surface, this is one control docked in a footer above the keyboard.
  textInputFocused: {
    borderColor: colors.ring,
    borderWidth: 1.5,
    ...shadows.subtle,
  },
  voiceStatusLine: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    backgroundColor: colors.background,
  },
  voiceStatusLineBlocked: {
    color: colors.destructive,
    fontWeight: "600",
  },
  sendButton: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  sendButtonText: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
  stopButton: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.destructive,
  },
  stopButtonText: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.destructiveForeground,
  },
});
