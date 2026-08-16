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
// it was actually unread) and navigates via `resolveNotificationRoute` from
// src/lib/deep-links.ts — the SAME resolver app/_layout.tsx's push-tap
// listener uses, not a local copy. `null` (a payload the resolver doesn't
// recognise) means "no route" here exactly like it does there: the
// notification is still marked read, the list just doesn't navigate anywhere.

import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useInfiniteQuery, useMutation, type InfiniteData } from "@tanstack/react-query";

import type { NotificationListResponse } from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton } from "@/components";
import { ScreenHeader } from "@/components/lists";
import { NotificationRow, type NotificationRowItem } from "@/components/notifications";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { resolveNotificationRoute } from "@/lib/deep-links";
import { getErrorMessage } from "@/lib/get-error-message";
import { notificationQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, spacing } from "@/theme/tokens";

export default function NotificationsScreen() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useScreenView("notifications");

  const notificationsQuery = useInfiniteQuery({
    ...notificationQueries.infiniteList(),
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

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.notifications.markRead(id),
    onSuccess: (_response, id) => {
      // Patches this list's cache directly rather than invalidating +
      // refetching: an invalidate on an infinite query re-fetches every
      // page the user has already scrolled through, in order, which both
      // wastes requests and can jitter the scroll position. The row's
      // `readAt` is the only thing that changed, so only that changes here.
      queryClient.setQueryData<InfiniteData<NotificationListResponse>>(notificationQueries.notificationQueries.list(), (existing) => {
        if (!existing) return existing;
        return {
          ...existing,
          pages: existing.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)),
          })),
        };
      });
      queryClient.setQueryData<number>(notificationQueries.notificationQueries.unreadCount(), (count) =>
        typeof count === "number" ? Math.max(0, count - 1) : count,
      );
    },
    onError: (err) => {
      notify(getErrorMessage(err, "Couldn't mark that notification as read."), "error");
    },
  });

  const handlePress = useCallback(
    (item: NotificationRowItem) => {
      if (!item.readAt) {
        markReadMutation.mutate(item.id);
      }
      const route = resolveNotificationRoute(item.data);
      if (route) {
        router.push(route as Href);
      }
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
    ({ item }: { item: NotificationRowItem }) => <NotificationRow notification={item} onPress={handlePress} />,
    [handlePress],
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
        description="Messages, shared-report nudges, and things a mentor assigns you will show up here."
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
      <ScreenHeader title="Notifications" eyebrow="Stay in the loop" subtitle="Messages, mentors, and shared reports." />
      <View style={styles.body}>{body}</View>
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
