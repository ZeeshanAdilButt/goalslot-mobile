// "Start a conversation" picker.
//
// The people offered here come from the sharing graph (see the shared
// `buildMessagingContacts`), which is the same relationship the API enforces
// server-side on POST /messaging/conversations. That duplication is
// deliberate and one-directional: this list decides what's OFFERED, the
// server decides what's ALLOWED. A stale cache can therefore only produce a
// clear 403 message, never unauthorised access — which is why the 403 branch
// below is a real, specifically-worded state rather than a generic error.
//
// Empty is the interesting state. A brand-new user has no sharing
// relationships at all, so "no one to message yet" is the FIRST thing most
// people will see here — it has to explain the sharing prerequisite rather
// than showing a bare "Nothing here". Sharing is set up on the web (see
// DECISIONS.md §5: sharing management is not a mobile v1 surface), so the
// copy says so instead of offering a button that goes nowhere.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";

import {
  contactsWithoutConversation,
  type MessagingContact,
} from "@goalslot/shared";

import { QueryErrorState } from "@/components/QueryErrorState";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { apiClient } from "@/lib/api-client";
import { hapticLight } from "@/lib/haptics";
import { describeCreateConversationError } from "@/lib/messaging-error";
import { messagingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { Avatar } from "./Avatar";

const RELATIONSHIP_LABEL: Record<MessagingContact["relationship"], string> = {
  mutual: "You share with each other",
  "shared-with-them": "You share your progress with them",
  "shared-with-me": "They share their progress with you",
};

export interface NewConversationSheetProps {
  /** User ids already in a conversation — those people belong in the list, not here. */
  existingCounterpartIds: string[];
  /** Called with the new (or existing) conversation id once the server answers. */
  onConversationReady: (conversationId: string) => void;
}

export const NewConversationSheet = forwardRef<BottomSheetModal, NewConversationSheetProps>(
  function NewConversationSheet({ existingCounterpartIds, onConversationReady }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);
    // See the hook's own header for why this is needed at all — the library
    // doesn't wire Android's hardware back button to the sheet on its own.
    const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);

    const [creatingFor, setCreatingFor] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const contactsQuery = useQuery(messagingQueries.contacts());

    const available = useMemo(
      () => contactsWithoutConversation(contactsQuery.data ?? [], existingCounterpartIds),
      [contactsQuery.data, existingCounterpartIds],
    );

    const handleSelect = useCallback(
      async (contact: MessagingContact) => {
        if (creatingFor) return;
        setCreatingFor(contact.userId);
        setError(null);
        hapticLight();

        try {
          const response = await apiClient.messaging.createConversation({ userId: contact.userId });
          // The new thread has to appear in the list behind the sheet, and
          // the server is the only thing that knows its participants and id.
          await queryClient.invalidateQueries({
            queryKey: messagingQueries.messagingQueries.conversations(),
          });
          sheetRef.current?.dismiss();
          onConversationReady(response.data.conversationId);
        } catch (err) {
          setError(describeCreateConversationError(err, contact.name).message);
        } finally {
          setCreatingFor(null);
        }
      },
      [creatingFor, onConversationReady],
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    return (
      // No text input in this sheet's content — nothing for the soft keyboard to cover.
      // eslint-disable-next-line no-restricted-syntax
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={["60%"]}
        onChange={handleSheetPositionChange}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            New message
          </Text>
          <Text style={styles.subtitle}>You can message anyone you have a sharing connection with.</Text>
        </View>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        {contactsQuery.isPending ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primaryPressed} />
          </View>
        ) : contactsQuery.isError && !contactsQuery.data ? (
          // `isError && !data`: a cached contact list must not be replaced
          // by a hard error just because a background refetch failed.
          <QueryErrorState
            compact
            error={contactsQuery.error}
            message="Couldn't load the people you can message."
            onRetry={() => void contactsQuery.refetch()}
          />
        ) : available.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>
              {(contactsQuery.data ?? []).length === 0
                ? "No one to message yet"
                : "You're already talking to everyone"}
            </Text>
            <Text style={styles.emptyBody}>
              {(contactsQuery.data ?? []).length === 0
                ? "Messaging is for people you share your progress with. Set up sharing on GoalSlot for web, then they'll show up here."
                : "Every one of your sharing connections already has a conversation. Open it from the list."}
            </Text>
          </View>
        ) : (
          <BottomSheetFlatList
            data={available}
            keyExtractor={(contact: MessagingContact) => contact.userId}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }: { item: MessagingContact }) => {
              const busy = creatingFor === item.userId;
              return (
                <Pressable
                  onPress={() => void handleSelect(item)}
                  disabled={creatingFor !== null}
                  style={({ pressed }) => [styles.contactRow, pressed && styles.contactRowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${item.name}. ${RELATIONSHIP_LABEL[item.relationship]}.`}
                  accessibilityState={{ disabled: creatingFor !== null, busy }}
                >
                  <Avatar name={item.name} size={40} />
                  <View style={styles.contactBody}>
                    <Text style={styles.contactName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.contactMeta} numberOfLines={1}>
                      {RELATIONSHIP_LABEL[item.relationship]}
                    </Text>
                  </View>
                  {busy ? <ActivityIndicator color={colors.mutedForeground} /> : null}
                </Pressable>
              );
            }}
          />
        )}
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
    height: 4,
    borderRadius: radii.full,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xxs,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  error: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  contactRowPressed: {
    backgroundColor: colors.secondary,
  },
  contactBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  contactName: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  contactMeta: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: {
    ...typography.headline,
    color: colors.foreground,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
});
