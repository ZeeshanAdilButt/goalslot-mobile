// Message thread.
//
// Routed as a hidden tab (`href: null` in the (app) layout) with the tab bar
// hidden while focused — the same pattern the note editor uses, and for the
// same reason: it keeps the group's auth guard without restructuring the
// navigator into a root stack. The practical consequence is that this screen
// stays MOUNTED after navigating back, so everything conversation-specific
// keys off `conversationId` and the focus effects below do the work that a
// mount effect would do in a stack.
//
// Keyboard behaviour is the part of a chat screen that most often goes wrong,
// so it is split deliberately:
//   * KeyboardAvoidingView here lifts the composer on both platforms.
//     `softwareKeyboardLayoutMode: "resize"` in app.json does NOT resize the
//     window on Android under edge-to-edge (on unconditionally past SDK 35)
//     — the OS ignores adjustResize there, so "height" is what actually
//     moves the composer, not a redundant double-count of the keyboard.
//   * `keyboardVerticalOffset` is 0 because this route hides the tab bar.
//     Coach passes 90 for exactly the opposite reason.
//   * Everything about staying pinned to the newest message lives in
//     `useThreadScroll`, including the keyboard-hide case that otherwise
//     strands the view above the last bubble.
//
// Read state: marked on focus and again whenever a message arrives while
// focused. Not on mount — see above, this component outlives a visit.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  contactsByUserId,
  DEFAULT_PAGE_SIZE,
  findCounterpart,
  mergeOlderMessages,
  applyReadReceipt,
  oldestMessageTimestamp,
  type MessagingConversation,
  type MessagingThreadMessage,
} from "@goalslot/shared";

import { EmptyState, ErrorState } from "@/components";
import { Icon } from "@/components/ui/Icon";
import {
  Avatar,
  formatDaySeparator,
  MessageBubble,
  MessageComposer,
  needsDaySeparator,
  OfflineBanner,
  ThreadSkeleton,
} from "@/components/messaging";
import { useMessagingConnection } from "@/hooks/useMessagingConnection";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useSendMessage } from "@/hooks/useSendMessage";
import { useThreadScroll } from "@/hooks/useThreadScroll";
import { messagingClient } from "@/lib/messaging-client";
import { messagingEnabled, messagingLiveEnabled } from "@/lib/messaging-config";
import { subscribeToIncomingMessages } from "@/lib/messaging-live";
import { useMessagingUiStore } from "@/lib/messaging-ui-store";
import { messagingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const UNKNOWN_PERSON = "Someone you shared with";
/** Start paging older history once the user is within this of the top. */
const LOAD_OLDER_THRESHOLD_PX = 240;

/** A day heading or a message — one flat array so the list stays virtualised. */
type ThreadRow =
  | { kind: "separator"; id: string; label: string }
  | { kind: "message"; id: string; message: MessagingThreadMessage };

function buildRows(messages: MessagingThreadMessage[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let previousIso: string | undefined;

  for (const message of messages) {
    if (needsDaySeparator(message.createdAt, previousIso)) {
      const label = formatDaySeparator(message.createdAt);
      if (label) rows.push({ kind: "separator", id: `sep-${message.id}`, label });
    }
    rows.push({ kind: "message", id: message.id, message });
    previousIso = message.createdAt;
  }

  return rows;
}

export default function MessageThreadScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof params.id === "string" ? params.id : "";

  const analytics = useAnalytics();
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";
  const reduceMotion = useReduceMotion();
  const connection = useMessagingConnection();
  const insets = useSafeAreaInsets();

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const loadingOlderRef = useRef(false);
  const isFocusedRef = useRef(false);

  // This screen is a tab and survives navigating between conversations, so
  // paging state has to be reset explicitly — otherwise a thread whose
  // history was fully loaded permanently disables "load older" for every
  // conversation opened afterwards.
  useEffect(() => {
    setHasMoreHistory(true);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
  }, [conversationId]);

  const conversationQuery = useQuery({
    ...messagingQueries.conversation(conversationId),
    // Gated on config as well as the id: an unconfigured build must show the
    // "not available" state below, not a request that rejects with
    // 'not-configured' and reads as a server failure.
    enabled: messagingEnabled && conversationId.length > 0,
  });

  const messagesQuery = useQuery({
    ...messagingQueries.messages(conversationId),
    enabled: messagingEnabled && conversationId.length > 0,
    // Live pushes patch this cache directly, but the socket is closed while
    // the app is backgrounded — so returning to a thread must re-read.
    refetchOnMount: "always",
  });

  const contactsQuery = useQuery({ ...messagingQueries.contacts(), enabled: messagingEnabled });

  const messages = useMemo<MessagingThreadMessage[]>(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const rows = useMemo(() => buildRows(messages), [messages]);

  const counterpartId = conversationQuery.data
    ? findCounterpart(conversationQuery.data, currentUserId)?.userId
    : undefined;
  const contactIndex = useMemo(() => contactsByUserId(contactsQuery.data ?? []), [contactsQuery.data]);
  const counterpartName = (counterpartId ? contactIndex[counterpartId]?.name : undefined) ?? UNKNOWN_PERSON;

  const draft = useMessagingUiStore((state) => state.drafts[conversationId] ?? "");
  const setDraft = useMessagingUiStore((state) => state.setDraft);

  const { send, retry, discard, isSending, error: sendError, clearError } = useSendMessage(
    conversationId,
    currentUserId,
  );

  const { listRef, onScroll, onContentSizeChange, scrollToBottom, isPinned, keyboardVisible } =
    useThreadScroll({ reduceMotion });

  // --- Mark as read -------------------------------------------------------

  const markRead = useCallback(async () => {
    if (!conversationId || !currentUserId) return;
    try {
      await messagingClient.markRead(conversationId);
      // Local echo so the unread dot in the list clears immediately rather
      // than on the next list refetch.
      queryClient.setQueryData<MessagingConversation[]>(
        messagingQueries.messagingQueries.conversations(),
        (existing) =>
          existing ? applyReadReceipt(existing, conversationId, currentUserId, new Date().toISOString()) : existing,
      );
    } catch {
      // Read state is a nicety. A failure here must not interrupt reading the
      // conversation — the next focus, or the next message, tries again.
    }
  }, [conversationId, currentUserId]);

  const refetchMessages = messagesQuery.refetch;

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      analytics.track({ name: "screenViewed", payload: { screenName: "message-thread" } });
      if (messagingEnabled && conversationId) {
        // A tab, not a stack entry — returning to a thread is a focus event,
        // not a mount, so `refetchOnMount` never fires again. Anything that
        // arrived while the socket was down (backgrounded, offline) is only
        // in the service's history until this runs.
        void refetchMessages();
        void markRead();
      }
      return () => {
        isFocusedRef.current = false;
      };
    }, [analytics, conversationId, markRead, refetchMessages]),
  );

  // --- Live messages: announce + keep read state current ------------------

  useEffect(() => {
    return subscribeToIncomingMessages((message) => {
      if (message.conversationId !== conversationId) return;
      // The cache is already patched by lib/messaging-live before listeners
      // run, so this only handles the two things a screen owns.
      if (message.senderId === currentUserId) return;

      if (isFocusedRef.current) {
        // A sighted user sees the bubble arrive; a screen-reader user gets no
        // signal at all unless it's announced. Polite, not assertive: it must
        // not interrupt whatever the user is currently reading.
        AccessibilityInfo.announceForAccessibility(`${counterpartName} said: ${message.body}`);
        void markRead();
      }
    });
  }, [conversationId, counterpartName, currentUserId, markRead]);

  // --- Paging older history ----------------------------------------------

  const loadOlder = useCallback(async () => {
    // Ref, not the `loadingOlder` state, as the in-flight guard. This is
    // called from `onScroll` at 16ms — several events fire before a
    // `setLoadingOlder(true)` re-render produces a callback that can see it,
    // so a state-only guard lets the same page be requested three or four
    // times. The state still exists, but only to drive the spinner.
    if (loadingOlderRef.current || !hasMoreHistory || messages.length === 0) return;
    const before = oldestMessageTimestamp(messages);
    if (!before) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await messagingClient.listMessages(conversationId, { limit: DEFAULT_PAGE_SIZE, before });
      // A short page means the beginning of the conversation. Checked on the
      // raw response, before the merge dedupes it — a full page that happens
      // to overlap entirely would otherwise look like "no more history".
      if (older.length < DEFAULT_PAGE_SIZE) setHasMoreHistory(false);
      if (older.length > 0) {
        queryClient.setQueryData<MessagingThreadMessage[]>(
          messagingQueries.messagingQueries.messages(conversationId),
          (existing) => mergeOlderMessages(existing ?? [], older),
        );
      }
    } catch {
      // Leave `hasMoreHistory` true so scrolling up again retries; a failed
      // page must not permanently truncate the thread.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, hasMoreHistory, messages]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      onScroll(event);
      if (event.nativeEvent.contentOffset.y < LOAD_OLDER_THRESHOLD_PX) {
        void loadOlder();
      }
    },
    [loadOlder, onScroll],
  );

  // --- Send ---------------------------------------------------------------

  const handleSend = useCallback(() => {
    const body = draft;
    if (body.trim().length === 0) return;
    clearError();
    // Clear the input immediately: the optimistic bubble is now the record of
    // what was typed, and leaving the text in place makes double-sending easy.
    setDraft(conversationId, "");
    // Always jump to the bottom on send, pinned or not — the user just added
    // to the end of the conversation, so that is where they want to be.
    scrollToBottom(true);
    void send(body);
  }, [clearError, conversationId, draft, scrollToBottom, send, setDraft]);

  const handleChangeText = useCallback(
    (text: string) => setDraft(conversationId, text),
    [conversationId, setDraft],
  );

  // --- Render -------------------------------------------------------------

  const renderRow = useCallback(
    ({ item }: { item: ThreadRow }) => {
      if (item.kind === "separator") {
        return (
          <View style={styles.separatorRow}>
            <Text style={styles.separatorLabel} accessibilityRole="header">
              {item.label}
            </Text>
          </View>
        );
      }
      return (
        <MessageBubble
          message={item.message}
          isOwn={item.message.senderId === currentUserId}
          counterpartName={counterpartName}
          onRetry={(clientId) => void retry(clientId)}
          onDiscard={discard}
        />
      );
    },
    [counterpartName, currentUserId, discard, retry],
  );

  // `isError && !data`, not `isError` alone: this screen refetches on every
  // focus, so a failed background refetch must not blow away an
  // already-loaded conversation header — same rule `threadUnreadable` below
  // already applies to the message list.
  const conversationFailed = conversationQuery.isError && !conversationQuery.data;
  // Only a failure with nothing to show is worth a full-screen error. This
  // screen refetches on every focus, so `isError` stays true after a failed
  // background refetch while `data` still holds the thread the user was
  // reading — and swapping a readable conversation for "couldn't load this"
  // is worse than showing it slightly stale under the offline banner. Same
  // rule the conversations list applies.
  const threadUnreadable = messagesQuery.isError && messages.length === 0;

  let body: React.ReactNode;

  if (!messagingEnabled) {
    body = (
      <EmptyState
        compact
        iconName="messages"
        message="Messaging isn't available here"
        description="This build of GoalSlot isn't connected to a messaging service."
      />
    );
  } else if (!conversationId) {
    body = <ErrorState message="That conversation link is missing an id." />;
  } else if (conversationQuery.isPending || messagesQuery.isPending) {
    body = <ThreadSkeleton />;
  } else if (conversationFailed || threadUnreadable) {
    body = (
      <ErrorState
        message={
          connection.online
            ? "Couldn't load this conversation."
            : "You're offline, so this conversation couldn't be loaded."
        }
        onRetry={() => {
          void conversationQuery.refetch();
          void messagesQuery.refetch();
        }}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        compact
        iconName="messages"
        tone="brand"
        message={`Say hello to ${counterpartName}`}
        description="Nothing here yet. Whatever you send lands on their phone too."
      />
    );
  } else {
    body = (
      <FlatList
        ref={listRef as React.RefObject<FlatList<ThreadRow>>}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        // Prepending older history must not move what the user is reading.
        // `minIndexForVisible: 1` anchors on the first item BELOW the top
        // edge, which is the item they're actually looking at.
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        keyboardShouldPersistTaps="handled"
        // Dragging the list closes the keyboard the way every native chat app
        // does, without stealing the tap that opens a bubble's retry button.
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        ListHeaderComponent={
          loadingOlder ? (
            <View style={styles.loadingOlder} accessibilityLabel="Loading earlier messages">
              <ActivityIndicator color={colors.mutedForeground} />
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace("/messages")}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to messages"
        >
          <Icon name="chevron-left" size={iconSize.lg} color={colors.foreground} />
        </Pressable>
        <Avatar name={counterpartName} size={36} />
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {counterpartName}
        </Text>
      </View>

      <OfflineBanner status={connection.status} online={connection.online} liveEnabled={messagingLiveEnabled} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        // 0, not Coach's 90: this route hides the tab bar, so there is no
        // chrome below the composer to compensate for.
        keyboardVerticalOffset={0}
      >
        <View style={styles.body}>{body}</View>

        {!isPinned && rows.length > 0 ? (
          <Pressable
            onPress={() => scrollToBottom(true)}
            style={styles.jumpToLatest}
            accessibilityRole="button"
            accessibilityLabel="Jump to the newest message"
          >
            <Text style={styles.jumpToLatestLabel}>Jump to latest</Text>
          </Pressable>
        ) : null}

        {sendError ? (
          <Text style={styles.errorBanner} accessibilityRole="alert">
            {sendError}
          </Text>
        ) : null}

        <MessageComposer
          value={draft}
          onChangeText={handleChangeText}
          onSend={handleSend}
          sending={isSending}
          disabled={!messagingEnabled || conversationFailed || !conversationId}
          placeholder={`Message ${counterpartName}`}
          // The keyboard's own frame already covers the home indicator, so
          // adding the inset while it's up leaves a visible gap.
          bottomInset={keyboardVisible ? 0 : insets.bottom}
        />
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
  body: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    marginLeft: -spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...typography.title,
    flex: 1,
    color: colors.foreground,
    // Clears the layout's floating hamburger, which is drawn over every
    // screen in this group.
    marginRight: spacing.xxxl,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  separatorRow: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  separatorLabel: {
    ...typography.caption,
    color: colors.mutedForeground,
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  loadingOlder: {
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  jumpToLatest: {
    position: "absolute",
    right: spacing.lg,
    bottom: 96,
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.foreground,
  },
  jumpToLatestLabel: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.white,
  },
  errorBanner: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
});
