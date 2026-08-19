// Recently logged sessions, grouped by day.
//
// The flat "one row per entry" list this replaces made it impossible to
// answer the question people actually bring to a time tracker — "how much
// did I do today?" — without adding it up by eye. Grouping by day with a
// per-day total on the header answers it for free, and mirrors the day
// grouping dw-time-web's recent-entries.tsx uses for the same feed.
//
// Rows keep the goal-colour dot and `formatDuration` formatting they already
// had, so a logged entry reads the same here as everywhere else in the app.
//
// UNATTRIBUTED ENTRIES are a first-class row shape here, not an edge case:
// now that a session can be started without picking anything, "logged but not
// filed" is a normal state a lot of entries will sit in. Such a row gets a
// hollow dot rather than the brand-coloured one (a filled brand dot made it
// look identical to a goal that happens to use the brand colour) and an
// "Add goal" hint that attaches one after the fact.
//
// ROW ACTIONS. Until recently this list was read-only: a session logged by
// mistake — and the 1-minute floor in timer.tsx's handleStop means a stray
// Start/Stop always logs one — sat in the history for good, with nothing on
// the row to remove it. Two actions now hang off each row, following the
// convention tasks.tsx already set for a list of records:
//
//   - swipe left  -> Delete, behind a themed ConfirmDialog (never
//                    `Alert.alert`; see ConfirmDialog.tsx's own header).
//   - tap the row -> ManualEntrySheet, prefilled from the entry, to edit it.
//                    This used to open the tracking picker alone, which could
//                    only re-file the session under a different goal — its
//                    duration, date, start time and title were unreachable
//                    from anywhere in the app once written, which is exactly
//                    what people tapping a row were trying to fix. The sheet
//                    is a superset: the goal/task link is still one tap away
//                    inside it, using the same picker.
//
// Both are reachable without the gesture: the row is one accessibility
// element whose activation opens the edit sheet, with Delete exposed as a
// custom accessibility action (the same `accessibilityActions`/
// `onAccessibilityAction` pairing notes.tsx uses for its own swipe actions).
//
// The delete mutation lives HERE rather than on the Timer screen even though
// the screen owns the sheet a tap opens. It needs nothing from the screen's
// timer state — an entry id and the recent-entries cache is the whole of it —
// and keeping it local means the Time Tracker screen didn't have to grow a
// third piece of history-row plumbing. Mutating from a component rather than
// a screen is already established here (see
// components/voice/TrackerVoiceButton.tsx, which posts time entries and
// queues them offline itself).

import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { FlashList } from "@shopify/flash-list";

import { formatDuration, type TimeEntry } from "@goalslot/shared";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import {
  buildSessionItems,
  describeSessionDelete,
  describeSessionEntry,
  removeSessionEntry,
  sessionEntryTitle,
} from "@/components/timer/session-entries";
import { apiClient, notify } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { queueOfflineEdit } from "@/lib/offline";
import { goalQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Same width tasks.tsx gives its own swipe actions, so the two lists' panels match. */
const SWIPE_ACTION_WIDTH = 92;

/**
 * This list's own baseline bottom breathing room — kept as a named constant
 * rather than read back off `styles.listContent` (StyleSheet.create's return
 * value isn't guaranteed to still be a plain object with real numbers at
 * runtime; RN is free to hand back an opaque registered id instead). `contentBottomInset`
 * below adds to this rather than replacing it.
 */
const LIST_CONTENT_BOTTOM_PADDING = spacing.xxxl;

/**
 * Delete is a custom action rather than the built-in `magicTap`/`escape`
 * vocabulary because it is genuinely app-specific, and it is declared once
 * at module scope so every memoised row shares the same array identity.
 * Activation (a plain double-tap under VoiceOver/TalkBack) is left as the
 * row's own `onPress`, which opens the edit sheet — the non-destructive of
 * the two, and so the right thing to sit on the default gesture. (It also
 * only opens a form; nothing about the entry changes until that form is
 * saved, so the default gesture stays reversible.)
 */
const ROW_ACCESSIBILITY_ACTIONS: AccessibilityActionInfo[] = [
  { name: "delete", label: "Delete session" },
];

export interface SessionHistoryProps {
  entries: TimeEntry[];
  refreshing: boolean;
  onRefresh: () => void;
  /**
   * Opens the edit sheet for an already-logged entry — see the ROW ACTIONS
   * note above. Offered on every row, not just unattributed ones.
   */
  onEditEntry: (entry: TimeEntry) => void;
  /**
   * Rendered above the first row, inside this list's own scroll view.
   *
   * The Timer screen passes its whole hero (title, ring, target, reminder
   * picker, transport controls) through here rather than stacking it above
   * the list as a sibling. That's what makes the screen scrollable: the hero
   * is now taller than a phone viewport on its own, so as siblings it
   * squeezed this list to nothing and there was no scroll container anywhere
   * to reach either. Feeding it to the list instead gives the screen exactly
   * one scroll view — and keeps FlashList's virtualization, which nesting it
   * inside a ScrollView would have broken.
   */
  ListHeaderComponent?: React.ReactElement | null;
  /**
   * Extra bottom padding beyond this list's own `spacing.xxxl` breathing
   * room — timer.tsx's pinned TimerControls footer (see its own header
   * comment for why Start/Pause/Stop moved out of the hero card into a
   * fixed bar below the scroll container) sits on top of whatever this list
   * renders last, and this is what keeps its final row from ending up
   * underneath it.
   */
  contentBottomInset?: number;
}

export function SessionHistory({
  entries,
  refreshing,
  onRefresh,
  onEditEntry,
  ListHeaderComponent,
  contentBottomInset = 0,
}: SessionHistoryProps) {
  const items = useMemo(() => buildSessionItems(entries), [entries]);

  // The entry the confirmation is asking about. Held as the whole entry, not
  // an id: the optimistic cache write below removes the row while the dialog
  // is still on screen (busy, and possibly about to show an error), so an
  // id would leave the dialog with nothing to render its own copy from.
  const [pendingDelete, setPendingDelete] = useState<TimeEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requestDelete = useCallback((entry: TimeEntry) => {
    setDeleteError(null);
    setPendingDelete(entry);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleteBusy]);

  /**
   * Snapshot -> optimistic removal -> live DELETE -> invalidate on success,
   * the same shape every other destructive action in this app uses
   * (tasks.tsx's handleDelete, notes.tsx's deleteNote).
   *
   * Two things are specific to a time entry:
   *
   *   - The goal collection is invalidated too when the entry had one. The
   *     API recomputes that goal's loggedHours on delete, so Goals, Today
   *     and Reports are all stale the moment this succeeds — and none of
   *     them would notice from the time-entry keys alone.
   *   - A network-looking failure queues to the outbox rather than rolling
   *     back, and the row stays gone. There is no "pending" version of gone
   *     to render (the same call schedule.tsx and notes.tsx's deleteNote
   *     make), so unlike an optimistic *edit* this one gets no `pendingSync`
   *     tag — the delete is going to happen once the outbox drains.
   *
   * A genuine server rejection is the only path that rolls back, and it
   * reports inline inside the dialog that is already open rather than
   * stacking a second popup on top of it.
   */
  const confirmDelete = useCallback(async () => {
    const entry = pendingDelete;
    if (!entry || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError(null);

    const listKey = timeEntryQueries.timeEntryQueries.recent();
    const previous = queryClient.getQueryData<TimeEntry[]>(listKey);
    queryClient.setQueryData<TimeEntry[]>(listKey, (existing) => removeSessionEntry(existing ?? [], entry.id));

    const announceRemoved = (suffix = "") => {
      AccessibilityInfo.announceForAccessibility(
        `Deleted ${formatDuration(entry.duration)} session "${sessionEntryTitle(entry)}"${suffix}`,
      );
    };

    try {
      await apiClient.timeEntries.delete(entry.id);
      hapticCompletion();
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      if (entry.goalId) {
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      }
      announceRemoved();
      setPendingDelete(null);
    } catch (err) {
      const queued = await queueOfflineEdit("time-entry-delete", { id: entry.id }, err);
      if (queued) {
        announceRemoved(" — will sync when online");
        notify("Queued — will sync when online", "offline");
        setPendingDelete(null);
      } else {
        queryClient.setQueryData<TimeEntry[]>(listKey, previous);
        setDeleteError("Couldn't delete that session. Please try again.");
      }
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, pendingDelete]);

  const confirmCopy = pendingDelete ? describeSessionDelete(pendingDelete) : null;

  return (
    <>
      <FlashList
        data={items}
        ListHeaderComponent={ListHeaderComponent}
        keyExtractor={(item) => item.key}
        // Lets FlashList recycle headers and rows separately instead of
        // reusing one cell shape for both.
        getItemType={(item) => item.kind}
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <DayHeader label={item.label} minutes={item.minutes} />
          ) : (
            <SessionRow entry={item.entry} onEdit={onEditEntry} onDelete={requestDelete} />
          )
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={[styles.listContent, { paddingBottom: LIST_CONTENT_BOTTOM_PADDING + contentBottomInset }]}
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={confirmCopy?.title ?? "Delete this session?"}
        description={confirmCopy?.description}
        icon="trash"
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </>
  );
}

function DayHeader({ label, minutes }: { label: string; minutes: number }) {
  return (
    <View style={styles.dayHeader} accessible accessibilityLabel={`${label}, ${formatDuration(minutes)} logged`}>
      <Text style={styles.dayLabel}>{label}</Text>
      <View style={styles.dayRule} />
      <Text style={styles.dayTotal}>{formatDuration(minutes)}</Text>
    </View>
  );
}

// Memoised: `entries`/`items` only change reference on an actual refetch, but
// the FlashList's own renderItem closure runs fresh every SessionHistory
// render (e.g. every keystroke this screen's picker sheet drives). Without
// this, every visible row re-rendered whenever the Timer screen re-rendered
// for a reason that had nothing to do with that particular entry.
const SessionRow = memo(function SessionRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: TimeEntry;
  onEdit: (entry: TimeEntry) => void;
  onDelete: (entry: TimeEntry) => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const goal = entry.goal;
  const title = sessionEntryTitle(entry);

  const renderRightActions = useCallback(
    () => (
      <Pressable
        style={[styles.swipeAction, styles.deleteAction]}
        onPress={() => {
          // Action first, then a guarded close(): the tap is FOR the action, so
          // nothing about dismissing the row may be able to swallow it. Matches
          // the Notes delete action, which is the one place this ordering was
          // already fixed.
          onDelete(entry);
          try {
            swipeableRef.current?.close();
          } catch {
            // Cosmetic only — the row stays visually open, but the
            // action above has already been dispatched.
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`Delete "${title}"`}
      >
        <Icon name="trash" size={18} color={colors.destructiveForeground} />
        <Text style={styles.swipeActionText}>Delete</Text>
      </Pressable>
    ),
    [entry, onDelete, title],
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "delete") onDelete(entry);
    },
    [entry, onDelete],
  );

  return (
    // marginBottom lives on the wrapper, not the row, so the Swipeable's own
    // height matches the row exactly and the revealed delete panel doesn't
    // bleed into the gap between rows. `overflow: hidden` on the same
    // wrapper clips that panel to the row's corner radius — without it a
    // square red block sits flush against a rounded card.
    <View style={styles.rowWrap}>
      <Swipeable ref={swipeableRef} renderRightActions={renderRightActions} overshootRight={false}>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => onEdit(entry)}
          accessibilityRole="button"
          accessibilityLabel={describeSessionEntry(entry)}
          accessibilityHint="Edits this session — its name, goal, date, start time and duration"
          accessibilityActions={ROW_ACCESSIBILITY_ACTIONS}
          onAccessibilityAction={handleAccessibilityAction}
        >
          {/* Hollow ring for an unattributed entry: a filled dot in the brand
              colour was indistinguishable from a goal whose colour is the brand
              colour, so "no goal" and "the yellow goal" looked the same. */}
          <View
            style={[
              styles.rowDot,
              goal ? { backgroundColor: goal.color } : styles.rowDotUnattributed,
            ]}
          />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            {goal?.title ? (
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {goal.title}
              </Text>
            ) : (
              // A hint, not a control: the whole row opens the edit sheet,
              // where the goal link lives, so a nested button here would be a
              // second accessibility element competing with its own parent
              // for the identical action. Marked as decoration for the same
              // reason — the row's label already says "no goal" and its hint
              // says what a tap does.
              <View style={styles.attachHint} importantForAccessibility="no-hide-descendants">
                <Icon name="add" size={13} color={colors.mutedForeground} />
                <Text style={styles.attachText}>Add goal</Text>
              </View>
            )}
          </View>
          <View style={styles.durationPill}>
            <Text style={styles.durationText}>{formatDuration(entry.duration)}</Text>
          </View>
        </Pressable>
      </Swipeable>
    </View>
  );
});

const styles = StyleSheet.create({
  listContent: {
    // spacing.md to stay flush with the Timer screen's hero card and its
    // "Recent sessions" header — see `timerCard` in app/(app)/timer.tsx for
    // why that screen runs a tighter gutter than a plain list screen.
    paddingHorizontal: spacing.md,
    paddingBottom: LIST_CONTENT_BOTTOM_PADDING,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  dayLabel: {
    ...typography.label,
    color: colors.foreground,
  },
  dayRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dayTotal: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.mutedForeground,
  },
  rowWrap: {
    marginBottom: spacing.sm,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    // The row is a touch target now, so it has to clear 44pt on its own
    // rather than relying on the content that happens to be inside it.
    minHeight: minTouchTarget,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowDotUnattributed: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  attachHint: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xxs,
  },
  attachText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  durationPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  durationText: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.foreground,
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  deleteAction: {
    backgroundColor: colors.destructive,
  },
  swipeActionText: {
    ...typography.label,
    color: colors.destructiveForeground,
    textAlign: "center",
  },
});
