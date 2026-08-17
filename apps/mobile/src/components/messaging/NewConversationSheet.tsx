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
// The guiding rule for this sheet, learned the hard way: it must NEVER be
// possible to open it and be shown nothing. It has five states — loading,
// failed to load, nobody in the sharing graph, everybody already has a
// thread, and a real list — and every one of them has to say something true
// and offer something to do. Four of the five used to be silently
// unreachable, because the sheet couldn't compute its own height and so
// never opened at all (see the enableDynamicSizing note below); with that
// fixed, they're worth designing:
//
//   - Nobody in the sharing graph. A brand-new user's FIRST experience here,
//     so it explains the sharing prerequisite rather than saying "Nothing
//     here". Sharing is set up on the web (DECISIONS.md §5: sharing
//     management is not a mobile v1 surface), so the copy says so instead of
//     offering a button that goes nowhere.
//   - Everybody already has a thread. Lists them and opens the existing
//     conversation on tap, rather than dead-ending on a sentence.
//   - Someone who hasn't accepted their invite yet is LISTED, greyed, with
//     the reason — not hidden. Hiding them is what emptied this list and
//     made the feature look broken; see buildMessagingContacts.

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

/**
 * Why a row can't be tapped. Every value here has to read as a fact about
 * the world plus what changes it — "Invite not accepted yet" tells the user
 * both that nothing is broken and who they're waiting on.
 */
const BLOCKED_REASON_LABEL: Record<NonNullable<MessagingContact["blockedReason"]>, string> = {
  "invite-pending": "Invite not accepted yet",
};

/**
 * One person. Shared by all three list states so a tappable row, a greyed
 * "waiting on them" row and an "open the existing thread" row can't drift
 * apart visually.
 */
function ContactRow({
  contact,
  subtitle,
  onPress,
  disabled = false,
  busy = false,
  accessibilityLabel,
}: {
  contact: MessagingContact;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel: string;
}) {
  const inert = disabled || !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.contactRow,
        pressed && !inert && styles.contactRowPressed,
        inert && styles.contactRowDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inert, busy }}
    >
      <Avatar name={contact.name} size={40} />
      <View style={styles.contactBody}>
        <Text style={styles.contactName} numberOfLines={1}>
          {contact.name}
        </Text>
        <Text style={styles.contactMeta} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {busy ? <ActivityIndicator color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

export interface NewConversationSheetProps {
  /**
   * counterpart user id -> the conversation id already open with them.
   *
   * A map rather than the bare id list it used to be, because "you're
   * already talking to everyone" is no longer a dead end: those people are
   * listed, and tapping one has to be able to jump straight to the thread.
   */
  existingConversationsByCounterpartId: Record<string, string>;
  /** Called with the new (or existing) conversation id once the server answers. */
  onConversationReady: (conversationId: string) => void;
}

export const NewConversationSheet = forwardRef<BottomSheetModal, NewConversationSheetProps>(
  function NewConversationSheet({ existingConversationsByCounterpartId, onConversationReady }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);
    // See the hook's own header for why this is needed at all — the library
    // doesn't wire Android's hardware back button to the sheet on its own.
    const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);

    const [creatingFor, setCreatingFor] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const contactsQuery = useQuery(messagingQueries.contacts());

    const contacts = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);

    /** People without a thread yet — including ones that can't be messaged, which are shown greyed. */
    const available = useMemo(
      () => contactsWithoutConversation(contacts, Object.keys(existingConversationsByCounterpartId)),
      [contacts, existingConversationsByCounterpartId],
    );

    /** People who already have a thread — the "already talking to everyone" state lists these. */
    const existingContacts = useMemo(
      () => contacts.filter((contact) => existingConversationsByCounterpartId[contact.userId]),
      [contacts, existingConversationsByCounterpartId],
    );

    const openExisting = useCallback(
      (contact: MessagingContact) => {
        const conversationId = existingConversationsByCounterpartId[contact.userId];
        if (!conversationId) return;
        hapticLight();
        sheetRef.current?.dismiss();
        onConversationReady(conversationId);
      },
      [existingConversationsByCounterpartId, onConversationReady],
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
        // DO NOT REMOVE — this prop is the whole reason this sheet opens at all.
        //
        // @gorhom/bottom-sheet v5 defaults `enableDynamicSizing` to TRUE
        // (components/bottomSheet/constants.ts: DEFAULT_DYNAMIC_SIZING), and
        // while it is on, explicit `snapPoints` are NOT enough: hooks/
        // useAnimatedDetents.ts skips the `!enableDynamicSizing` early-return
        // that would honour them, then bails with `return {}` because
        // `contentHeight` is still INITIAL_LAYOUT_VALUE (-999). `detents` is
        // therefore `undefined`, and every motion path guards on it —
        // handleSnapToIndex, evaluatePosition and isLayoutCalculated all
        // early-return — so `present()` is a silent no-op and even the
        // backdrop (appearsOnIndex={0}) never shows. Literally nothing
        // appears on screen.
        //
        // `contentHeight` is only ever written by BottomSheetView's onLayout
        // and by bottom-sheet scrollables' onContentSizeChange. This sheet's
        // header, error banner and all three explanatory states are plain
        // RN Views, which report nothing — so the sheet could only ever open
        // when the contact list branch rendered, and even then it sized
        // itself to the list alone (the header is outside it) and snapped to
        // the smallest detent, because useAnimatedDetents sorts descending.
        //
        // Turning dynamic sizing off routes through the early-return that
        // honours `snapPoints` immediately and never consults contentHeight:
        // a true fixed 60% sheet in every state. eslint's no-restricted-syntax
        // rule below enforces this pairing repo-wide.
        enableDynamicSizing={false}
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
        ) : contacts.length === 0 ? (
          // Genuinely nobody in the sharing graph. The only true empty state
          // left, and it explains the prerequisite rather than just saying
          // "nothing here".
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No one to message yet</Text>
            <Text style={styles.emptyBody}>
              Messaging is for people you share your progress with. Set up sharing on GoalSlot for web, then
              they&apos;ll show up here.
            </Text>
          </View>
        ) : available.length === 0 ? (
          // Everyone is already in a thread. This used to be a dead end — a
          // sentence telling the user to go back and find the conversation
          // themselves. Listing those people and opening the existing thread
          // on tap turns the same information into the thing they came here
          // to do.
          <>
            <Text style={styles.sectionNote}>
              You already have a conversation with everyone you share with. Pick one to open it.
            </Text>
            <BottomSheetFlatList
              data={existingContacts}
              keyExtractor={(contact: MessagingContact) => contact.userId}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }: { item: MessagingContact }) => (
                <ContactRow
                  contact={item}
                  subtitle="Already in your messages"
                  onPress={() => openExisting(item)}
                  accessibilityLabel={`Open your conversation with ${item.name}.`}
                />
              )}
            />
          </>
        ) : (
          <BottomSheetFlatList
            data={available}
            keyExtractor={(contact: MessagingContact) => contact.userId}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              // Only when the list is ENTIRELY unmessageable. Otherwise the
              // per-row subtitle already says it, and a footer would just be
              // noise under a list of people they can message right now.
              available.some((contact) => contact.messageable) ? null : (
                <Text style={styles.sectionNote}>
                  Once they accept your invite on GoalSlot for web, you&apos;ll be able to message them here.
                </Text>
              )
            }
            renderItem={({ item }: { item: MessagingContact }) =>
              item.messageable ? (
                <ContactRow
                  contact={item}
                  subtitle={RELATIONSHIP_LABEL[item.relationship]}
                  onPress={() => void handleSelect(item)}
                  // The whole list goes inert while one row is opening: a tap
                  // on a different row would start a second conversation the
                  // user never asked for.
                  disabled={creatingFor !== null}
                  busy={creatingFor === item.userId}
                  accessibilityLabel={`Message ${item.name}. ${RELATIONSHIP_LABEL[item.relationship]}.`}
                />
              ) : (
                // Shown, not hidden. Hiding these is what emptied the picker
                // and made the sheet look broken — see buildMessagingContacts.
                <ContactRow
                  contact={item}
                  subtitle={BLOCKED_REASON_LABEL[item.blockedReason ?? "invite-pending"]}
                  disabled
                  accessibilityLabel={`${item.name}. ${
                    BLOCKED_REASON_LABEL[item.blockedReason ?? "invite-pending"]
                  }, so you can't message them yet.`}
                />
              )
            }
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
  contactRowDisabled: {
    // Dimmed rather than hidden — the row is there to be read, not tapped.
    opacity: 0.55,
  },
  sectionNote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
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
