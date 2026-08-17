// "Previous chats" — lists every conversation this device has recorded (see
// src/lib/coach-history-store.ts's header for why that's a local index
// rather than a server list: the Coach API has no "list my conversations"
// endpoint, only one conversation per user+ISO-week). Presented from both
// Voice and Coach, each mounting its own instance — same convention as
// EditGoalSheet.tsx (a `present()`/`dismiss()` ref, no shared owner screen).
//
// Row tap, four different outcomes:
//   - the conversation the presenting screen is ALREADY showing (`activeScopeKey`,
//     passed by Coach, not by Voice): labelled "Currently open", dismisses
//     without navigating. Pushing the route you're already on is a no-op in
//     expo-router, so this used to close the sheet and change nothing.
//   - "live", this week, from a screen that isn't showing it: dismiss and land
//     on Coach's default thread (no scopeKey param) — the same conversation
//     this device is already showing, just from whichever screen the tap
//     happened on.
//   - "live", a past week: dismiss and push Coach with `scopeKey` in the
//     route params. Coach renders that thread read-only rather than letting
//     a message post into an old week's schedule/reflection context — see
//     coach.tsx's own header comment on why that's a correctness trap, not
//     a missing feature.
//   - "archived": the server row this came from is gone (it was snapshotted
//     right before a destructive "New chat" cleared it) — there is nothing
//     to navigate TO. Instead this sheet swaps its own body for the
//     archived turns, read-only, with a "Resume" action that just dismisses
//     the sheet: the composer already targets the current live
//     conversation, so "continuing the topic" needs nothing more than that.

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";

import { currentCoachWeekScopeKey, type ConversationIndexEntry } from "@goalslot/shared";

import { EmptyState } from "@/components/EmptyState";
import { FormattedText } from "@/components/ui/FormattedText";
import { Icon } from "@/components/ui/Icon";
import { formatConversationTimestamp } from "@/components/messaging/format";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import {
  backfillFromServer,
  getArchivedConversation,
  listConversations,
  type ArchivedConversationPayload,
} from "@/lib/coach-history-store";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface CoachHistorySheetRef {
  present: () => void;
  dismiss: () => void;
}

type SheetView = { mode: "list" } | { mode: "archived"; id: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The last few ISO weeks, most recent first — a short, cheap-to-fetch window for `backfillFromServer` rather than scanning arbitrarily far back. */
function recentPastScopeKeys(count: number): string[] {
  const now = Date.now();
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    keys.push(currentCoachWeekScopeKey(new Date(now - i * WEEK_MS)));
  }
  return keys;
}

// Module-level, not per-instance: Voice and Coach each mount their own
// CoachHistorySheet, and without this both would kick off the same backfill
// scan the first time either one is opened in a session — this flag is
// shared across both since they import the same module.
let backfillTriggeredThisSession = false;

function ConversationRow({
  entry,
  onPress,
  busy,
  disabled,
  isCurrentlyOpen,
}: {
  entry: ConversationIndexEntry;
  onPress: () => void;
  /** This row is the one that was tapped, and its navigation is in flight. */
  busy: boolean;
  /** Some row is opening — the whole list goes inert so a second tap can't queue a second navigation. */
  disabled: boolean;
  /** This row IS the conversation the presenting screen is already showing. */
  isCurrentlyOpen: boolean;
}) {
  const isPastWeek = entry.kind === "live" && entry.scopeKey !== currentCoachWeekScopeKey();
  // "Currently open" wins over "Read-only": a past week the user is already
  // viewing is both, and which conversation you're looking at is the more
  // useful of the two to say on a row you're deciding whether to tap.
  const meta = isCurrentlyOpen
    ? "Currently open"
    : entry.kind === "archived"
      ? "Archived"
      : isPastWeek
        ? "Read-only"
        : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title || "Conversation"}. ${entry.messageCount} messages, ${formatConversationTimestamp(entry.updatedAt)}${meta ? `, ${meta}` : ""}.`}
      accessibilityState={{ disabled, busy, selected: isCurrentlyOpen }}
    >
      <View style={styles.rowIcon}>
        <Icon name={entry.kind === "archived" ? "inbox" : "coach"} size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {entry.title || "New conversation"}
          </Text>
          <Text style={styles.rowTime}>{formatConversationTimestamp(entry.updatedAt)}</Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {entry.preview || "No messages yet"}
        </Text>
        <View style={styles.rowMetaLine}>
          <Text style={styles.rowMeta}>
            {entry.messageCount} {entry.messageCount === 1 ? "message" : "messages"}
          </Text>
          {meta ? (
            <>
              <Text style={styles.rowMetaDot}>·</Text>
              <Text style={styles.rowMeta}>{meta}</Text>
            </>
          ) : null}
        </View>
      </View>
      {busy ? <ActivityIndicator color={colors.mutedForeground} style={styles.rowSpinner} /> : null}
    </Pressable>
  );
}

function ArchivedDetail({
  loading,
  payload,
  onBack,
  onResume,
}: {
  loading: boolean;
  payload: ArchivedConversationPayload | null;
  onBack: () => void;
  onResume: () => void;
}) {
  return (
    <View style={styles.archivedContainer}>
      <View style={styles.archivedHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to previous chats"
          style={styles.backButton}
        >
          <Icon name="chevron-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Archived conversation
        </Text>
      </View>

      <View style={styles.archivedBanner}>
        <Icon name="alert" size={14} color={colors.mutedForeground} />
        <Text style={styles.archivedBannerText}>
          Read-only. The assistant no longer remembers this conversation — sending a message won&apos;t continue it.
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <Text style={styles.emptyBody}>Loading…</Text>
        </View>
      ) : !payload || payload.turns.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyBody}>This archived conversation couldn&apos;t be found.</Text>
        </View>
      ) : (
        <BottomSheetScrollView contentContainerStyle={styles.archivedContent}>
          {payload.turns.map((turn, index) => (
            <View
              key={index}
              style={[styles.bubble, turn.role === "USER" ? styles.bubbleUser : styles.bubbleAssistant]}
            >
              {turn.role === "ASSISTANT" ? (
                <FormattedText text={turn.content} style={styles.bubbleTextAssistant} />
              ) : (
                <Text style={styles.bubbleTextUser}>{turn.content}</Text>
              )}
            </View>
          ))}
        </BottomSheetScrollView>
      )}

      <View style={styles.archivedFooter}>
        <Pressable onPress={onResume} style={styles.resumeButton} accessibilityRole="button" accessibilityLabel="Start a new message on the current conversation">
          <Text style={styles.resumeButtonText}>Resume in current chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

export interface CoachHistorySheetProps {
  /**
   * The scopeKey the presenting screen is currently displaying, if it is
   * displaying one. Coach passes it; Voice doesn't (it never shows a thread
   * for a particular week). The row matching it is labelled "Currently open"
   * and doesn't navigate — before this, tapping it pushed the route the
   * screen was already on, which expo-router resolves to a no-op, so the
   * most-tapped row in the list (the list is sorted by recency, so the live
   * current-week conversation is usually first) closed the sheet and changed
   * nothing. That is indistinguishable from the feature being broken.
   */
  activeScopeKey?: string;
}

export const CoachHistorySheet = forwardRef<CoachHistorySheetRef, CoachHistorySheetProps>(function CoachHistorySheet(
  { activeScopeKey },
  ref,
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);
  const router = useRouter();

  const [view, setView] = useState<SheetView>({ mode: "list" });
  const [conversations, setConversations] = useState<ConversationIndexEntry[] | null>(null);
  const [archived, setArchived] = useState<ArchivedConversationPayload | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  /** The row whose navigation is in flight, so it can show a spinner and the rest of the list can go inert. */
  const [openingId, setOpeningId] = useState<string | null>(null);

  /**
   * Swaps the rendered rows in place, WITHOUT blanking first. Used by the
   * backfill's late `.then`: `setConversations(null)` there swapped the whole
   * FlatList out for the "Loading…" view seconds after the sheet had already
   * painted, which unmounted the row under the user's finger — a tap during
   * that window was genuinely lost, not just unacknowledged.
   */
  const refreshList = useCallback(() => {
    void listConversations().then(setConversations);
  }, []);

  /** Blanking, for `present()` only — there is nothing on screen yet to destroy. */
  const loadList = useCallback(() => {
    setConversations(null);
    refreshList();
  }, [refreshList]);

  useImperativeHandle(
    ref,
    () => ({
      present: () => {
        setView({ mode: "list" });
        setArchived(null);
        // Mandatory reset: unlike NewConversationSheet's `creatingFor`, this
        // is never cleared by a resolving promise — a row press ends in
        // navigation, and this sheet stays mounted behind it. Without this
        // every row would be permanently `disabled` from the second open on.
        setOpeningId(null);
        loadList();
        // Best-effort, non-blocking, once per app session: recovers
        // conversations that predate this feature or happened on another
        // device. See coach-history-store.ts's `backfillFromServer` — it
        // already skips any scopeKey the index knows as `live`, so this is
        // cheap on every open after the first.
        if (!backfillTriggeredThisSession) {
          backfillTriggeredThisSession = true;
          void backfillFromServer(recentPastScopeKeys(4)).then(refreshList);
        }
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [loadList, refreshList],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const openArchived = useCallback((id: string) => {
    setView({ mode: "archived", id });
    setArchived(null);
    setArchivedLoading(true);
    void getArchivedConversation(id).then((payload) => {
      setArchived(payload);
      setArchivedLoading(false);
    });
  }, []);

  const backToList = useCallback(() => setView({ mode: "list" }), []);

  const handleResume = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const handleRowPress = useCallback(
    (entry: ConversationIndexEntry) => {
      if (entry.kind === "archived") {
        openArchived(entry.id);
        return;
      }
      // Already showing this exact conversation: there is nothing to navigate
      // to, so just close. The row says "Currently open" rather than looking
      // like a destination that did nothing.
      if (activeScopeKey !== undefined && entry.scopeKey === activeScopeKey) {
        sheetRef.current?.dismiss();
        return;
      }
      // Immediate acknowledgement of the tap. Loading the target thread is a
      // network round trip (coach.tsx's `refetchOnMount: "always"`), and until
      // now the only feedback in that window was the sheet closing.
      setOpeningId(entry.id);
      // Navigate BEFORE dismissing. Same ordering SearchOverlay.tsx uses, and
      // the shape fixed in notes.tsx (8838b5e): if the dismiss ever throws,
      // the navigation must already have happened rather than being skipped.
      if (entry.scopeKey === currentCoachWeekScopeKey()) {
        router.push("/coach");
      } else {
        router.push({ pathname: "/coach", params: { scopeKey: entry.scopeKey } });
      }
      try {
        sheetRef.current?.dismiss();
      } catch {
        // Cosmetic only — the navigation above already happened, and
        // `present()` resets this sheet's state on the next open anyway.
      }
    },
    [activeScopeKey, openArchived, router],
  );

  return (
    // No text input in this sheet's content — nothing for the soft keyboard to cover.
    // eslint-disable-next-line no-restricted-syntax
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={["70%"]}
      onChange={handleSheetPositionChange}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      {view.mode === "archived" ? (
        <ArchivedDetail loading={archivedLoading} payload={archived} onBack={backToList} onResume={handleResume} />
      ) : (
        <View style={styles.listContainer}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Previous chats
            </Text>
          </View>

          {conversations === null ? (
            <View style={styles.centered}>
              <Text style={styles.emptyBody}>Loading…</Text>
            </View>
          ) : conversations.length === 0 ? (
            <EmptyState compact iconName="coach" message="No previous conversations yet." />
          ) : (
            <BottomSheetFlatList
              data={conversations}
              keyExtractor={(item: ConversationIndexEntry) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }: { item: ConversationIndexEntry }) => (
                <ConversationRow
                  entry={item}
                  onPress={() => handleRowPress(item)}
                  busy={openingId === item.id}
                  // The whole list, not just the tapped row: a second tap on a
                  // DIFFERENT row while one is opening would queue a second
                  // navigation, which is exactly what a user does when the
                  // first tap looks like it did nothing.
                  disabled={openingId !== null}
                  isCurrentlyOpen={
                    item.kind === "live" && activeScopeKey !== undefined && item.scopeKey === activeScopeKey
                  }
                />
              )}
            />
          )}
        </View>
      )}
    </BottomSheetModal>
  );
});

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
  listContainer: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
  },
  emptyBody: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    minHeight: minTouchTarget + spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },
  rowTime: {
    ...typography.label,
    color: colors.mutedForegroundLight,
  },
  rowPreview: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  rowMeta: {
    ...typography.label,
    color: colors.mutedForegroundLight,
  },
  rowMetaDot: {
    ...typography.label,
    color: colors.mutedForegroundLight,
  },
  rowSpinner: {
    alignSelf: "center",
  },
  archivedContainer: {
    flex: 1,
  },
  archivedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  archivedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.secondary,
  },
  archivedBannerText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    flex: 1,
    lineHeight: 17,
  },
  archivedContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: radii.lg,
    // Matches coach.tsx's live bubble padding — this renders the exact same
    // AI-reply content (extractCoachProposals'd, FormattedText'd), just from
    // an archived snapshot, so it should read at the same size.
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.primary,
    borderBottomRightRadius: radii.sm,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderBottomLeftRadius: radii.sm,
  },
  // Same size bump as coach.tsx's `bubbleTextUser`/`bubbleTextAssistant` —
  // see that file's comment.
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
  archivedFooter: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resumeButton: {
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  resumeButtonText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
