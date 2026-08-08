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
// The proposal-apply endpoint (POST /coach/proposals/apply) exists in
// @goalslot/shared's coach API but is intentionally not called here: a
// wrong auto-mutation of a real goal/schedule/task from a first-pass
// mobile screen is worse than a card the user can only look at. Proposal
// cards below are read-only.
//
// scopeKey is always "this ISO week" (currentCoachWeekScopeKey()) — web
// also offers month/quarter/year via a scope-period picker, which doesn't
// fit a phone-width chat screen in this pass.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  currentCoachWeekScopeKey,
  extractCoachProposals,
  type CoachMessageDto,
  type CoachProposalAction,
  type CoachProposalActionType,
  type CoachProposalBlock,
} from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton } from "@/components";
import { apiClient } from "@/lib/api-client";
import { coachQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, spacing, typography } from "@/theme/tokens";

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_MESSAGE = "You've used today's 30 Coach messages. It resets in 24 hours — try again later.";

interface ChatMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  pending?: boolean;
}

/** Human label for a proposal action type — no icon library is installed (see app/(app)/_layout.tsx), text-only. */
const ACTION_LABELS: Record<CoachProposalActionType, string> = {
  RENAME_GOAL: "Rename goal",
  UPDATE_GOAL: "Update goal",
  CREATE_GOAL: "Create goal",
  DELETE_GOAL: "Delete goal",
  CREATE_SCHEDULE_BLOCK: "Add schedule block",
  UPDATE_SCHEDULE_BLOCK: "Update schedule block",
  DELETE_SCHEDULE_BLOCK: "Remove schedule block",
  CREATE_TIME_ENTRY: "Log time",
  UPDATE_TIME_ENTRY: "Update time entry",
  DELETE_TIME_ENTRY: "Delete time entry",
  CREATE_TASK: "Create task",
  UPDATE_TASK: "Update task",
  DELETE_TASK: "Delete task",
  CREATE_PRACTICE: "Add active practice",
};

const DESTRUCTIVE_TYPES = new Set<CoachProposalActionType>(["DELETE_GOAL", "DELETE_SCHEDULE_BLOCK", "DELETE_TIME_ENTRY", "DELETE_TASK"]);

/**
 * Read-only summary of a proposed action's payload. Simpler than web's
 * describeAction (dw-time-web/src/features/coach/components/coach-proposal-card.tsx),
 * which resolves goal/schedule/time-entry ids against the React Query cache
 * to show human-readable names — that cache-preloading dance is a lot of
 * surface area for a card the user can't act on yet in this first pass, so
 * this shows what the model actually sent (title/time/date fields when
 * present) rather than resolving ids to names.
 */
function describeProposalAction(action: CoachProposalAction): string | null {
  const p = action.payload ?? {};
  const bits: string[] = [];
  if (typeof p.title === "string") bits.push(`"${p.title}"`);
  if (typeof p.startTime === "string" && typeof p.endTime === "string") {
    bits.push(`${p.startTime}–${p.endTime}`);
  }
  if (typeof p.date === "string") bits.push(p.date);
  if (typeof p.deadline === "string") bits.push(`due ${p.deadline}`);
  if (typeof p.duration === "number") bits.push(`${p.duration} min`);
  if (bits.length === 0 && action.id) bits.push(`#${action.id.slice(0, 8)}`);
  return bits.length ? bits.join(" · ") : null;
}

function ProposalCard({ block }: { block: CoachProposalBlock }) {
  const hasDestructive = block.actions.some((a) => DESTRUCTIVE_TYPES.has(a.type));
  return (
    <View style={styles.proposalCard} accessibilityRole="summary" accessibilityLabel="Coach proposed change, read only">
      <View style={styles.proposalHeader}>
        <Text style={styles.proposalHeaderText}>COACH PROPOSED CHANGE</Text>
        {block.summary ? <Text style={styles.proposalSummary}>{block.summary}</Text> : null}
      </View>
      {block.actions.map((action, i) => {
        const detail = describeProposalAction(action);
        return (
          <View key={i} style={styles.proposalRow}>
            <Text style={[styles.proposalActionLabel, DESTRUCTIVE_TYPES.has(action.type) && styles.proposalActionLabelDestructive]}>
              {ACTION_LABELS[action.type] ?? action.type}
            </Text>
            {detail ? <Text style={styles.proposalActionDetail}>{detail}</Text> : null}
          </View>
        );
      })}
      <Text style={styles.proposalFootnote}>
        {hasDestructive ? "Includes a delete. " : ""}
        Preview only — nothing changes. Applying proposals isn't supported on mobile yet; open GoalSlot on the web to apply this.
      </Text>
    </View>
  );
}

function ChatBubble({ message }: { message: ChatMessageView }) {
  const isUser = message.role === "USER";

  if (isUser) {
    return (
      <View style={styles.messageRow}>
        <View
          style={[styles.bubble, styles.bubbleUser]}
          accessible
          accessibilityLabel={`You said: ${message.content}`}
        >
          <Text style={styles.bubbleTextUser}>{message.content}</Text>
        </View>
      </View>
    );
  }

  const { cleaned, proposals, pending: proposalPending } = extractCoachProposals(message.content || "");
  const showTypingOnly = message.pending && !cleaned && !proposalPending && proposals.length === 0;

  return (
    <View style={[styles.messageRow, styles.messageRowAssistant]}>
      <Text style={styles.roleLabel}>Coach</Text>
      <View
        style={[styles.bubble, styles.bubbleAssistant]}
        accessible={!showTypingOnly}
        accessibilityLabel={showTypingOnly ? undefined : `Coach replied: ${cleaned}`}
      >
        {showTypingOnly ? (
          <View
            style={styles.typingIndicator}
            accessibilityLabel="Coach is typing"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.typingDot}>●</Text>
            <Text style={styles.typingDot}>●</Text>
            <Text style={styles.typingDot}>●</Text>
          </View>
        ) : (
          <>
            {cleaned ? <Text style={styles.bubbleTextAssistant}>{cleaned}</Text> : null}
            {message.pending && !proposalPending ? <Text style={styles.streamingCursor}>▍</Text> : null}
          </>
        )}
      </View>
      {proposalPending ? (
        <View style={styles.proposalPending} accessibilityLabel="Coach is preparing a proposed change">
          <Text style={styles.proposalPendingText}>Preparing a proposed change…</Text>
        </View>
      ) : null}
      {proposals.map((block, idx) => (
        <ProposalCard key={idx} block={block} />
      ))}
    </View>
  );
}

export default function CoachScreen() {
  const analytics = useAnalytics();
  const scopeKey = useMemo(() => currentCoachWeekScopeKey(), []);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "coach" } });
    }, [analytics]),
  );

  const historyQuery = useQuery({
    ...coachQueries.chat(scopeKey),
    // A reply that was still streaming server-side when the user navigated
    // away keeps generating on the server (the SSE bridge doesn't cancel on
    // client disconnect for a completed persist), so refetch on every
    // return to this screen picks it up instead of showing a stale thread.
    refetchOnMount: "always",
    staleTime: 0,
  });

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [optimisticUser, setOptimisticUser] = useState<ChatMessageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const persistedMessages = useMemo<ChatMessageView[]>(() => {
    return (historyQuery.data ?? [])
      .filter((m: CoachMessageDto) => m.role === "USER" || m.role === "ASSISTANT")
      .map((m: CoachMessageDto) => ({ id: m.id, role: m.role as "USER" | "ASSISTANT", content: m.content }));
  }, [historyQuery.data]);

  const allMessages = useMemo<ChatMessageView[]>(() => {
    const list = [...persistedMessages];
    if (optimisticUser) list.push(optimisticUser);
    if (streaming) {
      list.push({ id: "streaming-assistant", role: "ASSISTANT", content: streamingReply, pending: true });
    }
    return list;
  }, [persistedMessages, optimisticUser, streaming, streamingReply]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setInput("");
    const userMsgId = `local_user_${Date.now()}`;
    setOptimisticUser({ id: userMsgId, role: "USER", content: trimmed });
    setStreamingReply("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const iter = await apiClient.coach.streamChat(scopeKey, trimmed, { signal: controller.signal });
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
        setInput((cur) => cur || trimmed);
        setOptimisticUser(null);
      } else {
        await queryClient.invalidateQueries({ queryKey: coachQueries.coachQueries.chat(scopeKey) });
        setOptimisticUser(null);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Explicit Stop — not a failure, leave the thread as-is.
        return;
      }
      const status = (err as { status?: number } | undefined)?.status;
      const message = status === 429 ? RATE_LIMIT_MESSAGE : err instanceof Error ? err.message : "Couldn't reach the Coach.";
      setError(message);
      setInput((cur) => cur || trimmed);
      setOptimisticUser(null);
    } finally {
      setStreaming(false);
      setStreamingReply("");
      abortRef.current = null;
    }
  }, [input, scopeKey, streaming]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => {
    // Auto-scroll to the newest message as the thread grows or a reply streams in.
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [allMessages.length, streamingReply]);

  let body: React.ReactNode;
  if (historyQuery.isPending) {
    body = (
      <View style={styles.skeletonArea} accessibilityLabel="Loading conversation">
        <View style={[styles.skeletonBubble, styles.skeletonBubbleAssistant]}>
          <Skeleton height={14} width="70%" />
          <Skeleton height={14} width="45%" style={styles.skeletonLine} />
        </View>
        <View style={[styles.skeletonBubble, styles.skeletonBubbleUser]}>
          <Skeleton height={14} width="50%" />
        </View>
        <View style={[styles.skeletonBubble, styles.skeletonBubbleAssistant]}>
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="60%" style={styles.skeletonLine} />
        </View>
      </View>
    );
  } else if (historyQuery.isError) {
    body = <ErrorState message="Couldn't load your conversation with the Coach." onRetry={() => void historyQuery.refetch()} />;
  } else if (allMessages.length === 0) {
    body = (
      <EmptyState
        message="Ask the Coach anything about your goals, schedule, or how your week is going — it reads your real GoalSlot data to answer."
      />
    );
  } else {
    body = (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="none"
      >
        {allMessages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
      </ScrollView>
    );
  }

  const canSend = input.trim().length > 0 && input.length <= MAX_MESSAGE_LENGTH && !streaming;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Coach
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.bodyArea}>{body}</View>

        {error ? (
          <Text style={styles.errorBanner} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
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
      </KeyboardAvoidingView>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.foreground,
  },
  bodyArea: {
    flex: 1,
  },
  skeletonArea: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeletonBubble: {
    maxWidth: "78%",
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  skeletonBubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
  },
  skeletonBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.secondary,
  },
  skeletonLine: {
    marginTop: spacing.xxs,
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
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
  bubbleTextUser: {
    ...typography.body,
    color: colors.primaryForeground,
  },
  bubbleTextAssistant: {
    ...typography.body,
    color: colors.foreground,
  },
  streamingCursor: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  typingIndicator: {
    flexDirection: "row",
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  typingDot: {
    color: colors.mutedForeground,
    fontSize: 18,
    lineHeight: 18,
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
  proposalCard: {
    marginTop: spacing.xs,
    maxWidth: "92%",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  proposalHeader: {
    backgroundColor: colors.warningMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
  },
  proposalHeaderText: {
    ...typography.label,
    color: colors.foreground,
  },
  proposalSummary: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.foreground,
  },
  proposalRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xxs,
  },
  proposalActionLabel: {
    ...typography.caption,
    color: colors.foreground,
    textTransform: "uppercase",
  },
  proposalActionLabelDestructive: {
    color: colors.destructive,
  },
  proposalActionDetail: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  proposalFootnote: {
    ...typography.caption,
    fontWeight: "400",
    textTransform: "none",
    color: colors.mutedForeground,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  errorBanner: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
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
    fontSize: 15,
    color: colors.foreground,
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
