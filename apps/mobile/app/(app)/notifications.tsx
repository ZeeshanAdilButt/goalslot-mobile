// Notification center: the server-side `Notification` history (goal-slot-api's
// `notifications` module — see packages/shared/src/api/notifications.ts)
// rendered as a list, reached from the bell icon in the (app) layout's
// floating header column (see app/(app)/_layout.tsx). Same "pushed, hidden
// tab" shape as Messages/Sharing — registered with `href: null` so it isn't
// a seventh tab, reachable only from the bell.
//
// Pagination is cursor-based (packages/shared/src/queries/notifications.ts's
// `infiniteList()`), loaded via `useInfiniteQuery` + `onEndReached`, the
// standard RN "load more" shape — this app has no existing infinite list to
// mirror (Messages/Tasks/Goals are all flat single-page reads), so this is
// the first one.
//
// Tapping a row marks it read (PATCH /notifications/:id/read, only fired if
// it was actually unread) and then runs the tap through `runNotificationTap`
// (src/lib/notification-tap.ts) — the SAME dispatcher app/_layout.tsx's
// push-tap listener uses, so tapping a notification in the tray and tapping
// its row in here always do the same thing. An unrecognised payload means
// "no action" (the notification is still marked read, nothing else happens),
// which is how an older build tolerates a type a newer server added.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Linking, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useInfiniteQuery, useMutation, type InfiniteData } from "@tanstack/react-query";

import type { NotificationListResponse } from "@goalslot/shared";

import { Button, EmptyState, ErrorState, Skeleton } from "@/components";
import { HAMBURGER_CLEARANCE, ScreenHeader } from "@/components/lists";
import { NotificationRow, type NotificationRowItem } from "@/components/notifications";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { BELL_SCOPE } from "@/lib/notification-feed";
import {
  canMarkAllRead,
  markAllNotificationsReadInPages,
  markNotificationReadInPages,
  removeNotificationFromPages,
} from "@/lib/notification-read-cache";
import { runNotificationTap } from "@/lib/notification-tap";
import { notificationQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { checkForUpdateAndReload } from "@/lib/updates";
import { colors, spacing } from "@/theme/tokens";
import { useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";

export default function NotificationsScreen() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useScreenView("notifications");
  useHiddenTabBackHandler(hiddenTabBackDestination("notifications"));

  const notificationsQuery = useInfiniteQuery({
    ...notificationQueries.infiniteList(BELL_SCOPE),
    // Same reasoning as Messages: this screen is reached fresh every time
    // (it's pushed, not a tab that stays mounted), but the cache may hold a
    // stale first page from the bell badge's own `unreadCount()` read or an
    // earlier visit — always re-check on arrival rather than trust it.
    refetchOnMount: "always",
  });

  const items = useMemo<NotificationRowItem[]>(
    () => notificationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [notificationsQuery.data],
  );

  // Bridges this screen's read back onto the bell badge. Every list response
  // already carries `unreadCount`, but it lands under the infinite list's key
  // (`['notifications','list']`) while the badge in the (app) layout reads a
  // separate `['notifications','unread-count']` key — deliberately separate,
  // because the two cache different shapes (see the key factory's comment in
  // packages/shared/src/queries/notifications.ts). Nothing connected them, so
  // opening the inbox and reading everything left the badge showing whatever
  // number it had fetched at cold start. The freshest count wins: this screen
  // just refetched, so its number is newer than the badge's.
  // Also what the "Mark all read" control keys off — the SERVER's total for
  // this scope, not a count of the rows currently loaded. A user whose first
  // page happens to be all read but who has older unread rows still needs the
  // button.
  const unreadCount = notificationsQuery.data?.pages[0]?.unreadCount;
  const freshUnreadCount = unreadCount;
  useEffect(() => {
    if (typeof freshUnreadCount === "number") {
      queryClient.setQueryData<number>(notificationQueries.notificationQueries.unreadCount(BELL_SCOPE), freshUnreadCount);
    }
  }, [freshUnreadCount]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.notifications.markRead(id),
    onSuccess: (_response, id) => {
      // Patches this list's cache directly rather than invalidating +
      // refetching: an invalidate on an infinite query re-fetches every
      // page the user has already scrolled through, in order, which both
      // wastes requests and can jitter the scroll position. The row's
      // `readAt` is the only thing that changed, so only that changes here.
      queryClient.setQueryData<InfiniteData<NotificationListResponse>>(
        notificationQueries.notificationQueries.list(BELL_SCOPE),
        (existing) => markNotificationReadInPages(existing, id, new Date().toISOString()),
      );
      queryClient.setQueryData<number>(notificationQueries.notificationQueries.unreadCount(BELL_SCOPE), (count) =>
        typeof count === "number" ? Math.max(0, count - 1) : count,
      );
    },
    onError: (err) => {
      notify(getErrorMessage(err, "Couldn't mark that notification as read."), "error");
    },
  });

  const markAllReadMutation = useMutation({
    // ONE request for the whole scope, which the server serves with ONE
    // `updateMany`. Never a loop of per-row PATCHes: a user with a hundred
    // unread rows has to cost one statement, not a hundred round trips.
    //
    // BELL_SCOPE, the same scope this list is showing. Marking 'all' read
    // from a list that only ever showed 'general' would silently clear the
    // message notifications the user was never shown here.
    mutationFn: () => apiClient.notifications.markAllRead(BELL_SCOPE),
    onSuccess: (response) => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData<InfiniteData<NotificationListResponse>>(
        notificationQueries.notificationQueries.list(BELL_SCOPE),
        (existing) => markAllNotificationsReadInPages(existing, readAt),
      );
      // Straight off the mutation response — the server defines this as 0 by
      // construction (it just cleared every unread row in the scope), so
      // there is nothing to re-read and no follow-up request to pay for.
      queryClient.setQueryData<number>(
        notificationQueries.notificationQueries.unreadCount(BELL_SCOPE),
        response.data.unreadCount,
      );
    },
    onError: (err) => {
      notify(getErrorMessage(err, "Couldn't mark everything as read."), "error");
    },
  });

  const handleMarkAllRead = useCallback(() => {
    markAllReadMutation.mutate();
  }, [markAllReadMutation]);

  // The notification the delete confirmation is asking about. Held as the
  // whole row, not just an id, so the dialog still has a title to render
  // while it's busy/erroring — same construction as tasks.tsx's `pendingDelete`.
  const [pendingDelete, setPendingDelete] = useState<NotificationRowItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requestDelete = useCallback((notification: NotificationRowItem) => {
    setDeleteError(null);
    setPendingDelete(notification);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleteBusy]);

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError(null);

    try {
      await apiClient.notifications.delete(target.id);
      // Same "patch the cache, don't invalidate" reasoning as markRead above:
      // an invalidate on this infinite query would re-fetch every page the
      // user has already scrolled through. Only the deleted row changes.
      queryClient.setQueryData<InfiniteData<NotificationListResponse>>(
        notificationQueries.notificationQueries.list(BELL_SCOPE),
        (existing) => removeNotificationFromPages(existing, target.id).pages,
      );
      // Decrement the badge only if the deleted row was actually unread —
      // deleting an already-read row must not touch the unread count.
      if (!target.readAt) {
        queryClient.setQueryData<number>(notificationQueries.notificationQueries.unreadCount(BELL_SCOPE), (count) =>
          typeof count === "number" ? Math.max(0, count - 1) : count,
        );
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Couldn't delete that notification. Please try again."));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, pendingDelete]);

  const handlePress = useCallback(
    (item: NotificationRowItem) => {
      if (!item.readAt) {
        markReadMutation.mutate(item.id);
      }
      // Routed through the SAME dispatcher app/_layout.tsx's push-tap
      // listener uses (src/lib/notification-tap.ts), so an in-app row tap and
      // a tray tap on the same notification always do the same thing. This
      // used to call `resolveNotificationRoute`, which is navigation-only and
      // returns `null` for release notifications — so "a new app update is
      // available" rows marked themselves read and did nothing.
      runNotificationTap(item.data, {
        // Built at runtime from a notification payload, so never one of
        // expo-router's statically known literal paths — same `as Href`
        // escape hatch the rest of the app uses for dynamic routes.
        navigate: (href) => router.push(href as Href),
        openUrl: (url) => {
          void Linking.openURL(url).catch((err: unknown) => {
            notify(getErrorMessage(err, "Couldn't open that link."), "error");
          });
        },
        checkForUpdate: () => {
          void checkForUpdateAndReload(() => notify("Downloading the latest update…", "success")).catch(
            (err: unknown) => notify(getErrorMessage(err, "Couldn't check for an update."), "error"),
          );
        },
      });
    },
    [markReadMutation],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await notificationsQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [notificationsQuery]);

  const handleEndReached = useCallback(() => {
    if (notificationsQuery.hasNextPage && !notificationsQuery.isFetchingNextPage) {
      void notificationsQuery.fetchNextPage();
    }
  }, [notificationsQuery]);

  const renderItem = useCallback(
    ({ item }: { item: NotificationRowItem }) => (
      <NotificationRow notification={item} onPress={handlePress} onDelete={requestDelete} />
    ),
    [handlePress, requestDelete],
  );

  let body: React.ReactNode;

  if (notificationsQuery.isPending) {
    body = <NotificationListSkeleton />;
  } else if (notificationsQuery.isError && items.length === 0) {
    // Same "only a failure with nothing to show earns a full-screen error"
    // rule as Messages: a failed background refetch shouldn't blank out a
    // list the user can already see.
    body = (
      <ErrorState message="Couldn't load your notifications." onRetry={() => void notificationsQuery.refetch()} />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        emphasis="hero"
        iconName="bell"
        message="No notifications yet"
        description="Shared-report nudges, things a mentor assigns you, and app updates show up here. New messages live under the Messages icon."
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.listContent}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={notificationsQuery.isFetchingNextPage ? <FooterSpinner /> : null}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.mutedForeground} />
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        title="Notifications"
        eyebrow="Stay in the loop"
        // Messages deliberately absent from this list — they belong to the
        // Messages icon now. See src/lib/notification-feed.ts.
        subtitle="Mentors, shared reports, and app updates."
        // Docked in ScreenHeader's own `action` slot — its own row under the
        // title, right-aligned — which is where messages.tsx puts "New
        // message". Rendered only when there is actually something unread, so
        // the screen doesn't offer an action that would do nothing.
        action={
          canMarkAllRead(unreadCount) ? (
            <Button
              label="Mark all read"
              icon="check"
              variant="secondary"
              size="sm"
              onPress={handleMarkAllRead}
              loading={markAllReadMutation.isPending}
              disabled={markAllReadMutation.isPending}
              style={styles.headerAction}
            />
          ) : undefined
        }
      />
      <View style={styles.body}>{body}</View>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this notification?"
        description={pendingDelete?.title}
        icon="trash"
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </SafeAreaView>
  );
}

function FooterSpinner() {
  return (
    <View style={styles.footerSpinner}>
      <Skeleton width="100%" height={64} borderRadius={12} />
    </View>
  );
}

function NotificationListSkeleton() {
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} width="100%" height={72} borderRadius={12} />
      ))}
    </View>
  );
}

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
  listContent: {
    paddingBottom: spacing.xxl,
  },
  // Hugs the right edge like messages.tsx's "New message", but keeps the
  // floating column's gutter clear as well. ScreenHeader reserves
  // HAMBURGER_CLEARANCE on the TITLE block only — its `action` row has no
  // right gutter, and the (app) layout's three stacked 40pt buttons (menu,
  // search, bell) plus their hitSlop reach roughly 152pt down the right edge,
  // which is the band this row sits in. Reserving it here is the same fix
  // that column's own comment records for the Messages screen, where its dead
  // zone ate the top slice of a header action button.
  headerAction: {
    alignSelf: "flex-end",
    marginRight: HAMBURGER_CLEARANCE - spacing.xl,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + 40 + spacing.md,
  },
  footerSpinner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  skeletonList: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
