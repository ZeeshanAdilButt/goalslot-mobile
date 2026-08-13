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
} from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton } from "@/components";
import { CoachProposalCard } from "@/components/coach/CoachProposalCard";
import { CoachBudgetNotice } from "@/components/settings/CoachBudgetNotice";
import { useApplyCoachProposals } from "@/hooks/useApplyCoachProposals";
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

function ChatBubble({
  message,
  onApply,
}: {
  message: ChatMessageView;
  /** Omitted while a reply is still streaming — half a proposal isn't a proposal. */
  onApply?: (actions: CoachProposalAction[]) => Promise<string>;
}) {
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
        <View key={idx} style={styles.proposalSlot}>
          <CoachProposalCard block={block} onApply={onApply} />
        </View>
      ))}
    </View>
  );
}

export default function CoachScreen() {
  const analytics = useAnalytics();
  const scopeKey = useMemo(() => currentCoachWeekScopeKey(), []);
  const { apply } = useApplyCoachProposals();

  const applyActions = useCallback(
    (actions: CoachProposalAction[]) => apply({ actions }),
    [apply],
  );

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
          // A still-streaming reply gets no Apply button: `extractCoachProposals`
          // reports a half-arrived block as `pending`, and offering to apply
          // what has landed so far would let the user agree to a fragment.
          <ChatBubble key={m.id} message={m} onApply={m.pending ? undefined : applyActions} />
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
