// Mentees: people who have shared THEIR data with the signed-in user, i.e.
// the direction goal-slot-api's sharing graph calls `shared-with-me` — see
// packages/shared/src/queries/sharing.ts. This is the mobile entry point for
// the three things a mentor could not do on this app before: see a mentee's
// reports, message them, and assign them an instruction. All three already
// existed as real API surface (sharing's shared-user reads, messaging's
// open-a-conversation, and the instructions module) — this screen and
// mentee/[id].tsx are what makes them reachable here.
//
// Sharing *management* (inviting someone, accepting/declining, revoking) is
// still web-only by deliberate decision (DECISIONS.md §5) — this screen only
// reads the directory that management produces, the same read messaging's
// contact picker already relies on.

import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";

import { type IncomingShare } from "@goalslot/shared";

import { EmptyState, QueryErrorState, SkeletonListItem } from "@/components";
import { ListCard, ScreenHeader } from "@/components/lists";
import { Avatar } from "@/components/messaging";
import { AssignInstructionSheet } from "@/components/mentees/AssignInstructionSheet";
import { HiddenTabBackButton, useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";
import { Button } from "@/components/ui/Button";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { messagingEnabled } from "@/lib/messaging-config";
import { describeCreateConversationError } from "@/lib/messaging-error";
import { messagingQueries, sharingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, spacing, typography } from "@/theme/tokens";

function displayName(share: IncomingShare): string {
  const trimmed = share.owner.name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : share.owner.email;
}

export default function MenteesScreen() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [messagingFor, setMessagingFor] = useState<string | null>(null);
  const [messagingError, setMessagingError] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);
  const assignSheetRef = useRef<BottomSheetModal>(null);

  const menteesQuery = useQuery(sharingQueries.sharedWithMe());

  useScreenView("mentees");

  // This route is a hidden Tabs.Screen (see app/(app)/_layout.tsx), not a
  // pushed stack entry, so the OS back gesture/button doesn't reliably
  // return to where the user came from — it was landing on the Today
  // dashboard instead. Same fix note/[id].tsx and notification-settings.tsx
  // already use for the identical problem. The drawer is the only way to
  // reach this screen, so Today (its own default landing tab) is the
  // destination rather than picking one drawer item over another.
  useHiddenTabBackHandler(hiddenTabBackDestination("mentees"));

  const mentees = useMemo(() => menteesQuery.data ?? [], [menteesQuery.data]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await menteesQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [menteesQuery]);

  const openReports = useCallback((ownerId: string) => {
    router.push(`/mentee/${ownerId}`);
  }, []);

  const openAssign = useCallback((mentee: { id: string; name: string }) => {
    setAssignTarget(mentee);
    assignSheetRef.current?.present();
  }, []);

  const handleMessage = useCallback(async (mentee: { id: string; name: string }) => {
    if (messagingFor) return;
    setMessagingFor(mentee.id);
    setMessagingError(null);
    try {
      // Opens OR reuses the existing thread — the same call
      // NewConversationSheet makes, so a mentee already being messaged just
      // lands back in that same conversation instead of a duplicate.
      const response = await apiClient.messaging.createConversation({ userId: mentee.id });
      await queryClient.invalidateQueries({ queryKey: messagingQueries.messagingQueries.conversations() });
      router.push(`/message/${response.data.conversationId}`);
    } catch (err) {
      // forbidden/network get a persistent inline banner — the user needs to
      // know the sharing connection (or their own connectivity) is the
      // problem before trying again. Anything else is a one-off toast: a
      // genuine server rejection is worth retrying, not worth leaving a
      // banner up about.
      const { kind, message } = describeCreateConversationError(err, mentee.name);
      if (kind === "forbidden" || kind === "network") {
        setMessagingError(message);
      } else {
        notify("Couldn't open that conversation.", "error");
      }
    } finally {
      setMessagingFor(null);
    }
  }, [messagingFor]);

  let body: React.ReactNode;

  if (menteesQuery.isPending) {
    body = (
      <View>
        <SkeletonListItem />
        <SkeletonListItem />
        <SkeletonListItem />
      </View>
    );
  } else if (menteesQuery.isError && mentees.length === 0) {
    body = (
      <QueryErrorState
        error={menteesQuery.error}
        message="Couldn't load your mentees."
        onRetry={() => void menteesQuery.refetch()}
      />
    );
  } else if (mentees.length === 0) {
    body = (
      <EmptyState
        emphasis="hero"
        iconName="mentees"
        message="No mentees yet"
        description="This list is people who share their progress with you. Set up sharing on GoalSlot for web, then they'll show up here."
      />
    );
  } else {
    body = (
      <FlatList
        data={mentees}
        keyExtractor={(share) => share.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.mutedForeground} />
        }
        renderItem={({ item, index }) => {
          const name = displayName(item);
          const busy = messagingFor === item.owner.id;
          return (
            <ListCard index={index} style={styles.card}>
              <View style={styles.row}>
                <Avatar name={name} size={44} />
                <View style={styles.identity}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.email} numberOfLines={1}>
                    {item.owner.email}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                <Button
                  label="Reports"
                  icon="reports"
                  variant="secondary"
                  size="sm"
                  style={styles.actionButton}
                  onPress={() => openReports(item.owner.id)}
                  accessibilityLabel={`View ${name}'s reports`}
                />
                {messagingEnabled ? (
                  <Button
                    label="Message"
                    icon="messages"
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    style={styles.actionButton}
                    onPress={() => void handleMessage({ id: item.owner.id, name })}
                    accessibilityLabel={`Message ${name}`}
                  />
                ) : null}
                <Button
                  label="Assign"
                  icon="instructions"
                  variant="secondary"
                  size="sm"
                  style={styles.actionButton}
                  onPress={() => openAssign({ id: item.owner.id, name })}
                  accessibilityLabel={`Assign an instruction to ${name}`}
                />
              </View>
            </ListCard>
          );
        }}
        ListHeaderComponent={
          messagingError ? (
            <Text style={styles.messagingError} accessibilityRole="alert">
              {messagingError}
            </Text>
          ) : null
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <HiddenTabBackButton label="Today" destination="/" />
      <ScreenHeader
        title="Sharing"
        eyebrow="Mentor view"
        subtitle="People sharing their progress with you."
      />

      <View style={styles.body}>{body}</View>

      <AssignInstructionSheet ref={assignSheetRef} mentee={assignTarget} />
    </SafeAreaView>
  );
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
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  messagingError: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  card: {
    marginBottom: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identity: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  email: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
