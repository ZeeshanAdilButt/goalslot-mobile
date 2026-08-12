// Tap a block on the timeline, get its details.
//
// This is the mobile counterpart to dw-time-web/src/features/schedule/
// components/schedule-block-detail-dialog.tsx and follows its content order
// exactly: a full-width color bar, then Day / Time / Category / Linked Goal /
// Tasks as small uppercase labels over semibold values, with Delete behind a
// confirmation (the web uses ConfirmDialog; RN's Alert is the native
// equivalent). Duration is the one addition — it's free from the two times
// and it's the number you actually want when reading a plan.
//
// WHY this replaces the old swipe-to-delete row action: the redesigned screen
// positions blocks on a time axis, where a 15-minute block is ~30px tall and a
// horizontal swipe both fights the vertical scroll and has nowhere to reveal an
// action panel. The delete path itself is unchanged — same optimistic cache
// write, same `scheduleBlockDeleted` analytics event — it just hangs off a
// detail surface now, which is also where the web puts it.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import {
  DAYS_OF_WEEK_FULL,
  formatDuration,
  formatTime12h,
  timeToMinutes,
  type ScheduleBlock,
} from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { SheetHandle } from "@/components/ui/SheetHandle";
// Primitive half of the same token set (both resolve to theme/foundation.ts).
import { typography as typeScale } from "@/theme";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

// The taller of this sheet's two detents. The shorter one comes from
// `enableDynamicSizing` (the measured content height), so a short block still
// opens as a compact card and only grows if the user asks it to.
//
// Two detents is the point: with dynamic sizing and no `snapPoints` the sheet
// has exactly ONE, so a drag upward is clamped to where the sheet already is
// and the handle does nothing at all. See SheetHandle.tsx.
const EXPANDED_SNAP_POINT = "88%";

export interface BlockDetailSheetProps {
  block: ScheduleBlock | null;
  onDelete: (block: ScheduleBlock) => void;
  onEdit: (block: ScheduleBlock) => void;
  onDismiss: () => void;
  /** Whether this block's reminder notification is currently on — see useScheduleReminders.ts. */
  reminderEnabled: boolean;
  onToggleReminder: () => void;
}

export const BlockDetailSheet = forwardRef<BottomSheetModal, BlockDetailSheetProps>(function BlockDetailSheet(
  { block, onDelete, onEdit, onDismiss, reminderEnabled, onToggleReminder },
  ref,
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);

  // A BottomSheetModal is portalled to BottomSheetModalProvider at the app
  // root (app/_layout.tsx), so it renders OUTSIDE the screen's
  // `<SafeAreaView edges={["top"]}>` — and every screen in this app only
  // claims the top edge anyway. Android has been edge-to-edge since SDK 54,
  // so the sheet's bottom edge is the bottom of the physical display, behind
  // the gesture pill (~24dp) or the three-button nav bar (~48dp); on iOS it's
  // behind the home indicator (34pt). Without this the Edit/Delete row was
  // drawn under the system bar — visible enough to look "merged into" it,
  // and with the lower part of a 44pt target not tappable at all.
  //
  // Same reasoning and the same fix already applied in
  // components/timer/TrackingPicker.tsx, which is the one sheet in the app
  // that got this right.
  const insets = useSafeAreaInsets();

  const snapPoints = useMemo(() => [EXPANDED_SNAP_POINT], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const handleDelete = useCallback(() => {
    if (!block) return;
    // Same copy as the web's ConfirmDialog in schedule-block-detail-dialog.tsx.
    Alert.alert("Delete time slot", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          sheetRef.current?.dismiss();
          onDelete(block);
        },
      },
    ]);
  }, [block, onDelete]);

  const duration = useMemo(() => {
    if (!block) return "";
    return formatDuration(timeToMinutes(block.endTime) - timeToMinutes(block.startTime));
  }, [block]);

  const handleEdit = useCallback(() => {
    if (!block) return;
    sheetRef.current?.dismiss();
    onEdit(block);
  }, [block, onEdit]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      // Both together, deliberately: the library merges the measured content
      // height into the provided list (useAnimatedDetents), so this sheet ends
      // up with a content-hugging detent AND an expanded one, sorted shortest
      // first. Index 0 — where a modal opens by default — stays the compact
      // card for a short block, and a block with a long task list opens at 88%
      // and can be dragged the rest of the way.
      enableDynamicSizing
      snapPoints={snapPoints}
      enablePanDownToClose
      handleComponent={SheetHandle}
      backgroundStyle={styles.sheetBackground}
    >
      {/* Scrollable, not a plain BottomSheetView: dynamic sizing caps the
          sheet at the container height, and a BottomSheetView has no way to
          reach whatever spills past that — a block with a dozen tasks simply
          lost its Edit/Delete row off the bottom. It also makes the expanded
          detent worth dragging to. */}
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
      >
        {block ? (
          <>
            {/* Web: `h-1.5 w-full rounded-full` in the block's category color. */}
            <View style={[styles.colorBar, { backgroundColor: block.goal?.color ?? block.color }]} />

            <Text style={styles.title}>{block.title}</Text>

            <View style={styles.factGrid}>
              <Fact label="Day" value={DAYS_OF_WEEK_FULL[block.dayOfWeek]} />
              <Fact label="Time" value={`${formatTime12h(block.startTime)} – ${formatTime12h(block.endTime)}`} />
              <Fact label="Duration" value={duration} />
              {block.category ? <Fact label="Category" value={block.category} swatch={block.color} /> : null}
              {block.goal ? <Fact label="Linked goal" value={block.goal.title} swatch={block.goal.color} /> : null}
            </View>

            {block.tasks && block.tasks.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Tasks ({block.tasks.length})</Text>
                {block.tasks.map((task) => (
                  <View key={task.id} style={styles.taskRow}>
                    <Icon name="tasks" size={13} color={colors.mutedForeground} />
                    <Text style={styles.taskText} numberOfLines={2}>
                      {task.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* "ability to be able to turn on alarms for all schedule blocks
                and also ability to stop all or one" — this is the "or one"
                half; the bulk on/off lives in the Schedule screen's header. */}
            <View style={styles.reminderRow}>
              <View style={styles.reminderLabelGroup}>
                <Icon name={reminderEnabled ? "bell" : "bell-off"} size={16} color={colors.mutedForeground} />
                <Text style={styles.reminderLabel}>Reminder</Text>
              </View>
              <Switch
                value={reminderEnabled}
                onValueChange={onToggleReminder}
                accessibilityRole="switch"
                accessibilityLabel="Reminder"
                accessibilityState={{ checked: reminderEnabled }}
              />
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={styles.editButton}
                onPress={handleEdit}
                accessibilityRole="button"
                accessibilityLabel="Edit"
              >
                <Icon name="edit" size={16} color={colors.foreground} />
                <Text style={styles.editText}>Edit</Text>
              </Pressable>
              <Pressable
                style={styles.deleteButton}
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete"
              >
                <Icon name="trash" size={16} color={colors.destructive} />
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function Fact({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <View style={styles.factValueRow}>
        {swatch ? <View style={[styles.swatch, { backgroundColor: swatch }]} /> : null}
        <Text style={styles.factValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  // `flex: 1` on the scrollable itself, not on its content container: the
  // sheet measures the CONTENT size for dynamic sizing (onContentSizeChange),
  // so this doesn't inflate the collapsed height — it just lets the scrollable
  // fill whichever detent the sheet is sitting at, which is what makes the
  // overflow at the expanded one actually scroll. Same shape ScheduleBlockSheet
  // uses.
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    // paddingBottom is applied at the call site — it has to add the bottom
    // safe-area inset, which isn't a static value.
    gap: spacing.lg,
  },
  // Web: `h-1.5 w-full rounded-full`.
  colorBar: {
    height: spacing.sm - spacing.xxs,
    borderRadius: radii.full,
  },
  title: {
    ...typography.h1,
    fontSize: typeScale.size.xl,
    color: colors.foreground,
  },
  factGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.lg,
    columnGap: spacing.xxl,
  },
  fact: {
    minWidth: 120,
    gap: spacing.xxs,
  },
  factLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  factValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  factValue: {
    flexShrink: 1,
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  section: {
    gap: spacing.sm,
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.muted,
  },
  reminderLabelGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reminderLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  taskText: {
    flexShrink: 1,
    ...typography.body,
    color: colors.foreground,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  editButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    borderRadius: radii.lg,
    backgroundColor: colors.muted,
  },
  editText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  deleteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    borderRadius: radii.lg,
    backgroundColor: colors.destructiveMuted,
  },
  deleteText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.destructive,
  },
});
