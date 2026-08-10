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
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

import {
  DAYS_OF_WEEK_FULL,
  formatDuration,
  formatTime12h,
  timeToMinutes,
  type ScheduleBlock,
} from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
// Primitive half of the same token set (both resolve to theme/foundation.ts).
import { typography as typeScale } from "@/theme";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface BlockDetailSheetProps {
  block: ScheduleBlock | null;
  onDelete: (block: ScheduleBlock) => void;
  onDismiss: () => void;
}

export const BlockDetailSheet = forwardRef<BottomSheetModal, BlockDetailSheetProps>(function BlockDetailSheet(
  { block, onDelete, onDismiss },
  ref,
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);

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

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      enableDynamicSizing
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
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

            <Pressable
              style={styles.deleteButton}
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete"
            >
              <Icon name="trash" size={16} color={colors.destructive} />
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          </>
        ) : null}
      </BottomSheetView>
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
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
    height: 4,
    borderRadius: radii.full,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
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
  deleteButton: {
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
