// Messages: the conversations list.
//
// Routing follows the Notes pattern documented in DECISIONS.md — this screen
// plus `message/[id].tsx`, both registered as hidden tabs (`href: null`) in
// the (app) layout so they inherit the group's auth guard without needing a
// root stack, with the thread route additionally hiding the tab bar so it
// reads as a full-screen push.
//
// The list joins two sources: jiffy-messaging knows the conversations but
// only by bare user id, and GoalSlot's sharing directory knows the names.
// Neither is authoritative about the other, so a conversation whose
// counterpart has dropped out of the sharing graph still renders (with a
// fallback label) rather than disappearing — the history is real even if the
// relationship ended.
//
// Live updates arrive through the app-level socket (src/lib/messaging-live.ts,
// started by the (app) layout), which patches THIS query's cache directly.
// That's why there is no socket subscription here: the list is already
// correct by the time this component re-renders.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";

import {
  contactsByUserId,
  DELETED_MESSAGE_TEXT,
  findCounterpart,
  isConversationUnread,
  isDeletedMessage,
  newestServerMessage,
  removeConversation,
  toMessagingError,
  type MessagingConversation,
} from "@goalslot/shared";

import { Button, EmptyState, ErrorState } from "@/components";
import { ScreenHeader } from "@/components/lists";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  ConversationListSkeleton,
  ConversationRow,
  formatMessagePreview,
  NewConversationSheet,
  OfflineBanner,
} from "@/components/messaging";
import { useMessagingConnection } from "@/hooks/useMessagingConnection";
import { useScreenView } from "@/hooks/useScreenView";
import { messagingClient } from "@/lib/messaging-client";
import { messagingEnabled, messagingLiveEnabled } from "@/lib/messaging-config";
import { messagingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAuth } from "@/providers/auth-provider";
import { colors, spacing } from "@/theme/tokens";
import { useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";

/** Shown when a conversation's counterpart isn't in the sharing directory any more. */
const UNKNOWN_PERSON = "Someone you shared with";

export default function MessagesScreen() {
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";
  const connection = useMessagingConnection();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // The conversation whose delete is being confirmed, held whole so the
  // dialog can name the person rather than say "this conversation".
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const conversationsQuery = useQuery({
    ...messagingQueries.conversations(),
    // Never fire against an unconfigured service. Without this the queries
    // would reject with 'not-configured' and the screen would report a
    // failure, when the honest answer is "this build has no messaging".
    enabled: messagingEnabled,
    // The socket keeps this fresh while the app is foregrounded, but it is
    // disconnected while backgrounded (see useMessagingLiveUpdates) — so
    // coming back to this screen has to re-read rather than trust the cache.
    refetchOnMount: "always",
  });

  // Names come from the sharing directory. A failure here is NOT a failure of
  // the screen: conversations still render with the fallback label, so this
  // query's error state is deliberately ignored rather than surfaced.
  const contactsQuery = useQuery({ ...messagingQueries.contacts(), enabled: messagingEnabled });

  const refetchConversations = conversationsQuery.refetch;

  useScreenView("messages");
  useHiddenTabBackHandler(hiddenTabBackDestination("messages"));

  useFocusEffect(
    useCallback(() => {
      // `refetchOnMount` isn't enough here. This screen is a tab, so it stays
      // mounted after the user navigates away — returning to it is a FOCUS
      // event, not a mount, and without this the list would show whatever the
      // cache held when they left.
      if (messagingEnabled) {
        void refetchConversations();
      }
    }, [refetchConversations]),
  );

  const contactIndex = useMemo(() => contactsByUserId(contactsQuery.data ?? []), [contactsQuery.data]);

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  // counterpart id -> conversation id. The sheet needs the id, not just
  // membership: when every contact already has a thread it lists them and
  // opens the existing conversation on tap, instead of dead-ending on a
  // sentence telling the user to go back and find it themselves.
  const existingConversationsByCounterpartId = useMemo(() => {
    const byCounterpart: Record<string, string> = {};
    for (const conversation of conversations) {
      const counterpartId = findCounterpart(conversation, currentUserId)?.userId;
      if (counterpartId) byCounterpart[counterpartId] = conversation.id;
    }
    return byCounterpart;
  }, [conversations, currentUserId]);

  const openThread = useCallback((conversationId: string) => {
    router.push(`/message/${conversationId}`);
  }, []);

  const openNewConversation = useCallback(() => {
    sheetRef.current?.present();
  }, []);

  // --- Deleting a conversation -------------------------------------------
  //
  // For this user only. The other person keeps theirs along with every
  // message in it, and anything they send afterwards brings this one back
  // with only the new messages - which is why the cached thread is dropped
  // outright rather than kept in sync with history the service will no
  // longer return to this user.
  //
  // Not optimistic: the row stays until the service confirms, so a failure
  // is a message inside the dialog rather than a row that vanished and came
  // back.

  const requestDelete = useCallback((conversationId: string, name: string) => {
    setDeleteError(null);
    setPendingDelete({ id: conversationId, name });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await messagingClient.deleteConversation(id);
      queryClient.setQueryData<MessagingConversation[]>(messagingQueries.messagingQueries.conversations(), (existing) =>
        existing ? removeConversation(existing, id) : existing,
      );
      queryClient.removeQueries({ queryKey: messagingQueries.messagingQueries.messages(id) });
      queryClient.removeQueries({ queryKey: messagingQueries.messagingQueries.conversation(id) });
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(toMessagingError(error).message);
    } finally {
      setDeleteBusy(false);
    }
  }, [pendingDelete]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetchConversations();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchConversations]);

  const renderItem = useCallback(
    ({ item }: { item: MessagingConversation }) => {
      const counterpartId = findCounterpart(item, currentUserId)?.userId;
      return (
        <ConversationListItem
          conversation={item}
          currentUserId={currentUserId}
          name={(counterpartId ? contactIndex[counterpartId]?.name : undefined) ?? UNKNOWN_PERSON}
          onPress={openThread}
          // Deleting needs the service, so offline the row stays press-only
          // rather than offering a long press that can only fail.
          onRequestDelete={connection.online ? requestDelete : undefined}
        />
      );
    },
    [connection.online, contactIndex, currentUserId, openThread, requestDelete],
  );

  let body: React.ReactNode;

  if (!messagingEnabled) {
    // Reachable only by URL (the drawer entry is omitted in this build), so
    // it has to say something true rather than sit on a spinner forever.
    body = (
      <EmptyState
        emphasis="hero"
        iconName="messages"
        message="Messaging isn't available here"
        description="This build of GoalSlot isn't connected to a messaging service. Open GoalSlot on the web to reach the people you share with."
      />
    );
  } else if (conversationsQuery.isPending) {
    body = <ConversationListSkeleton />;
  } else if (conversationsQuery.isError && conversations.length === 0) {
    // `isError` alone is the wrong condition in an offline-first app: this
    // screen refetches on every focus, and a failed background refetch leaves
    // `isError` true while `data` still holds a perfectly good cached list.
    // Replacing that list with a full-screen error is a regression from what
    // the user could already see. Only a failure with nothing to show is a
    // failure worth a screen; anything else falls through to the list, with
    // the offline banner explaining why it might be stale.
    body = (
      <ErrorState
        message={
          connection.online
            ? "Couldn't load your conversations."
            : "You're offline, so your conversations couldn't be loaded."
        }
        onRetry={() => void conversationsQuery.refetch()}
      />
    );
  } else if (conversations.length === 0) {
    body = (
      <EmptyState
        emphasis="hero"
        iconName="messages"
        tone="brand"
        message="No conversations yet"
        description="Message the people you share your progress with — a mentor, a study partner, whoever's keeping you honest."
        actionLabel="New message"
        actionIcon="add"
        onAction={openNewConversation}
      />
    );
  } else {
    body = (
      <FlatList
        data={conversations}
        keyExtractor={(conversation) => conversation.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            // Tracked explicitly rather than off `isFetching`: this screen
            // also refetches on every focus, and binding the spinner to
            // `isFetching` would flash a pull-to-refresh indicator every time
            // the user came back to the list.
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.mutedForeground}
          />
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        title="Messages"
        eyebrow="Stay in touch"
        subtitle="People you share your progress with."
        action={
          conversations.length > 0 ? (
            <Button
              label="New message"
              icon="add"
              variant="secondary"
              size="sm"
              onPress={openNewConversation}
              style={styles.headerAction}
            />
          ) : undefined
        }
      />

      <OfflineBanner status={connection.status} online={connection.online} liveEnabled={messagingLiveEnabled} />

      <View style={styles.body}>{body}</View>

      <NewConversationSheet
        ref={sheetRef}
        existingConversationsByCounterpartId={existingConversationsByCounterpartId}
        onConversationReady={openThread}
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this conversation?"
        description={
          pendingDelete
            ? `It leaves your messages along with everything in it so far. ${pendingDelete.name} keeps their copy. If they message you again it comes back with only the new messages.`
            : undefined
        }
        icon="trash"
        confirmLabel="Delete for me"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />
    </SafeAreaView>
  );
}

interface ConversationListItemProps {
  conversation: MessagingConversation;
  currentUserId: string;
  name: string;
  onPress: (conversationId: string) => void;
  /** Omitted while offline; see the call site. */
  onRequestDelete?: (conversationId: string, name: string) => void;
}

/**
 * A row, plus the one piece of data the conversation list can't count on.
 *
 * jiffy-messaging's documented conversation shape guarantees participants and
 * their `lastReadAt`, but NOT a last-message preview — so `lastMessage` is
 * optional and this falls back to the thread's own cache for it. `enabled:
 * false` makes that a pure cache read: it never issues a request (fetching
 * every thread to render a list would be one request per row), but it still
 * subscribes, so a socket push into an open thread updates this row's preview
 * and unread state live.
 *
 * When the service does populate `lastMessage`, it wins — it's authoritative
 * and covers threads this device has never opened.
 *
 * Memoised for the same reason ConversationRow itself is (see its own
 * docblock): without it, every row re-renders — re-running this component's
 * `useQuery` and preview/unread computation — on any parent re-render (e.g.
 * `isRefreshing` toggling on pull-to-refresh), not just when its own
 * conversation actually changed. A bare inline `onPress` closure would defeat
 * that even with the memo in place, so the callback handed to ConversationRow
 * is stabilised with `useCallback` too.
 */
const ConversationListItem = memo(function ConversationListItem({
  conversation,
  currentUserId,
  name,
  onPress,
  onRequestDelete,
}: ConversationListItemProps) {
  const cachedThread = useQuery({ ...messagingQueries.messages(conversation.id), enabled: false });

  const lastMessage = conversation.lastMessage ?? newestServerMessage(cachedThread.data) ?? null;
  const preview = isDeletedMessage(lastMessage)
    ? // A deleted message has an empty body, which formatMessagePreview would
      // turn into "No messages yet" - reading as if the conversation had
      // never been used at all.
      DELETED_MESSAGE_TEXT
    : formatMessagePreview(lastMessage?.body, lastMessage?.senderId === currentUserId ? "You: " : undefined);
  const conversationId = conversation.id;
  const handlePress = useCallback(() => onPress(conversationId), [onPress, conversationId]);
  // Stabilised for the same reason handlePress is: a bare inline closure
  // would defeat this component's own memo on every parent re-render.
  const handleLongPress = useCallback(
    () => onRequestDelete?.(conversationId, name),
    [conversationId, name, onRequestDelete],
  );

  return (
    <ConversationRow
      name={name}
      preview={preview}
      timestamp={lastMessage?.createdAt ?? conversation.updatedAt}
      unread={isConversationUnread(conversation, currentUserId, lastMessage)}
      onPress={handlePress}
      onLongPress={onRequestDelete ? handleLongPress : undefined}
    />
  );
});

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  headerAction: {
    alignSelf: "flex-end",
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    // Starts past the avatar, the way every native conversation list does —
    // a full-bleed rule reads as a table, an inset one as a list of people.
    marginLeft: spacing.lg + 44 + spacing.md,
  },
});
