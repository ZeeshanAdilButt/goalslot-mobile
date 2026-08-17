// Tap a block on the timeline, get its details.
//
// This is the mobile counterpart to dw-time-web/src/features/schedule/
// components/schedule-block-detail-dialog.tsx and follows its content order
// exactly: a full-width color bar, then Day / Time / Category / Linked Goal /
// Tasks as small uppercase labels over semibold values, with Delete behind a
// confirmation (this app's own themed ConfirmDialog, same as the web's).
// Duration is the one addition — it's free from the two times and it's the
// number you actually want when reading a plan.
//
// WHY this replaces the old swipe-to-delete row action: the redesigned screen
// positions blocks on a time axis, where a 15-minute block is ~30px tall and a
// horizontal swipe both fights the vertical scroll and has nowhere to reveal an
// action panel. The delete path itself is unchanged — same optimistic cache
// write, same `scheduleBlockDeleted` analytics event — it just hangs off a
// detail surface now, which is also where the web puts it.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
  type ScheduleDeleteScope,
} from "@goalslot/shared";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { SheetHandle } from "@/components/ui/SheetHandle";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
// Owned by the reminders store/hook (schedule-reminders-store.ts,
// useScheduleReminders.ts) — this sheet only renders the three-way choice,
// it never resolves or persists one itself.
import type { ReminderTier } from "@/lib/schedule-reminders-store";
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
  onDelete: (block: ScheduleBlock, scope: ScheduleDeleteScope) => void;
  onEdit: (block: ScheduleBlock) => void;
  onDismiss: () => void;
  /** This block's own resolved reminder tier — see useScheduleReminders.ts's getReminderTier. */
  reminderTier: ReminderTier;
  onChangeReminderTier: (tier: ReminderTier) => void;
  /** How many blocks share this block's seriesId. 1 means it isn't really a series. */
  seriesSize: number;
  /**
   * The whole series/group's tier — the "set Reading everywhere" control.
   * "mixed" when the days don't all currently share one tier (getGroupTier).
   */
  seriesTier: ReminderTier | "mixed";
  onChangeSeriesTier: (tier: ReminderTier) => void;
}

export const BlockDetailSheet = forwardRef<BottomSheetModal, BlockDetailSheetProps>(function BlockDetailSheet(
  {
    block,
    onDelete,
    onEdit,
    onDismiss,
    reminderTier,
    onChangeReminderTier,
    seriesSize,
    seriesTier,
    onChangeSeriesTier,
  },
  ref,
) {
  const isSeries = seriesSize > 1;
  const sheetRef = useRef<BottomSheetModal>(null);
  // No dependency array on purpose. @gorhom/bottom-sheet's own
  // `useImperativeHandle` inside BottomSheetModal has no deps either, so it
  // hands back a BRAND NEW handle object on every render, and its `present`
  // closes over the sheet's internal `mount` state. Freezing this forwarder
  // with `[]` pinned the first-render handle — a `present` that believes the
  // sheet is permanently unmounted — and the only reason that has not shown
  // up as a sheet that refuses to open is that dismissing resets `mount` to
  // false and accidentally re-syncs the stale closure. Re-reading the child
  // ref every render costs nothing and does not rely on that accident.
  useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal);
  // See the hook's own header for why this is needed at all — the library
  // doesn't wire Android's hardware back button to the sheet on its own.
  const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);

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

  const [pendingDelete, setPendingDelete] = useState(false);

  const snapPoints = useMemo(() => [EXPANDED_SNAP_POINT], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const remove = useCallback(
    (scope: ScheduleDeleteScope) => {
      if (!block) return;
      sheetRef.current?.dismiss();
      onDelete(block, scope);
    },
    [block, onDelete],
  );

  // A solo block gets a plain two-way confirm; a series gets a genuine
  // three-way choice (Cancel / this day only / all N days) — see the
  // ConfirmDialog rendered below for both shapes. The reason it is a prompt
  // rather than a default: "Reading" on five weekdays is five rows, and
  // guessing wrong in either direction is bad. Silently deleting the series
  // destroys four days the user never mentioned; silently deleting one
  // leaves them doing it five times, which is the complaint that started
  // this. So ask, and make the destructive-to-many option say how many.
  const handleDelete = useCallback(() => {
    if (!block) return;
    setPendingDelete(true);
  }, [block]);

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
    <>
    {/* No text input in this sheet's content — nothing for the soft keyboard to cover. */}
    {/* eslint-disable-next-line no-restricted-syntax */}
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onDismiss}
      onChange={handleSheetPositionChange}
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
                half; the master on/off lives in the Schedule screen's header.
                Between the two sits the series row below: setting "Reading"
                once instead of opening five days and picking five times.
                Off/Notify/Alarm rather than the old on/off switch: a quiet
                "Notify" tier sits between full silence and the loud alarm
                treatment (sound + vibration + bypasses Focus/DND). */}
            <View style={styles.reminderRow}>
              <View style={styles.reminderLabelGroup}>
                <Icon name={reminderTier === "off" ? "bell-off" : "bell"} size={16} color={colors.mutedForeground} />
                <View style={styles.reminderCopy}>
                  <Text style={styles.reminderLabel}>Reminder for this day</Text>
                  <Text style={styles.reminderHint}>
                    {describeReminderTier(reminderTier, `at ${formatTime12h(block.startTime)}`)}
                  </Text>
                </View>
              </View>
              <ReminderTierControl
                value={reminderTier}
                onChange={onChangeReminderTier}
                accessibilityLabel={`Reminder for this day, ${DAYS_OF_WEEK_FULL[block.dayOfWeek]} at ${formatTime12h(block.startTime)}`}
              />
            </View>

            {isSeries ? (
              <View style={styles.reminderRow}>
                <View style={styles.reminderLabelGroup}>
                  <Icon name={seriesTier === "off" ? "bell-off" : "bell"} size={16} color={colors.mutedForeground} />
                  <View style={styles.reminderCopy}>
                    <Text style={styles.reminderLabel}>Reminder for all {seriesSize} days</Text>
                    <Text style={styles.reminderHint}>
                      {seriesTier === "mixed"
                        ? `Different for each of the ${seriesSize} days`
                        : describeReminderTier(seriesTier, `every day “${block.title}” repeats`)}
                    </Text>
                  </View>
                </View>
                <ReminderTierControl
                  value={seriesTier}
                  onChange={onChangeSeriesTier}
                  accessibilityLabel={`Reminder for all ${seriesSize} days of ${block.title}`}
                />
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
                onPress={handleEdit}
                accessibilityRole="button"
                accessibilityLabel="Edit"
              >
                <Icon name="edit" size={16} color={colors.foreground} />
                <Text style={styles.editText}>Edit</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
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

    {/* One dialog handling both shapes, gated on `isSeries`: a solo block
        gets a plain Cancel/Delete pair, a series gets a genuine third option
        ("All N days") rendered via ConfirmDialog's tertiary slot. */}
    <ConfirmDialog
      visible={pendingDelete && block !== null}
      title="Delete time slot"
      description={
        isSeries && block
          ? `"${block.title}" repeats on ${seriesSize} days. This can't be undone.`
          : "This can't be undone."
      }
      confirmLabel={isSeries ? "This day only" : "Delete"}
      destructive
      onConfirm={() => {
        setPendingDelete(false);
        remove("single");
      }}
      onCancel={() => setPendingDelete(false)}
      tertiaryLabel={isSeries ? `All ${seriesSize} days` : undefined}
      onTertiary={
        isSeries
          ? () => {
              setPendingDelete(false);
              remove("series");
            }
          : undefined
      }
    />
    </>
  );
});

/** Off / Notify / Alarm, in the order they should read left to right. */
const TIER_OPTIONS: ReadonlyArray<{ tier: ReminderTier; label: string }> = [
  { tier: "off", label: "Off" },
  { tier: "notify", label: "Notify" },
  { tier: "alarm", label: "Alarm" },
];

/** Plain-language effect of a tier, for the hint line under its label. `whenLabel` reads like "at 6:00 PM" or "every day it repeats". */
function describeReminderTier(tier: ReminderTier, whenLabel: string): string {
  if (tier === "off") return "No alert";
  if (tier === "notify") return `Notifies quietly ${whenLabel}`;
  return `Rings and vibrates ${whenLabel}`;
}

/**
 * The three-way Off/Notify/Alarm choice, replacing the old on/off Switch.
 * Same segmented-pill-row convention as ReminderIntervalPicker.tsx and
 * JournalReminderTimePicker.tsx — a fixed set of three, so unlike those two
 * this doesn't need to scroll, just three equal-width pills.
 */
function ReminderTierControl({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: ReminderTier | "mixed";
  onChange: (tier: ReminderTier) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.tierRow} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {TIER_OPTIONS.map(({ tier, label }) => {
        const selected = value === tier;
        return (
          <Pressable
            key={tier}
            style={({ pressed }) => [styles.tierChip, selected && styles.tierChipSelected, pressed && styles.tierChipPressed]}
            onPress={() => onChange(tier)}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.tierChipLabel, selected && styles.tierChipLabelSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

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
  // Column, not the row-with-a-Switch-on-the-right this replaced: three
  // pills need more width than a switch ever did, so the tier control gets
  // its own full-width line below the label instead of squeezing in beside
  // it — same stacking ReminderIntervalPicker/JournalReminderTimePicker use
  // for their own label-then-options layout.
  reminderRow: {
    gap: spacing.sm,
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
  reminderCopy: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  reminderLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  reminderHint: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  // Three equal pills rather than ReminderIntervalPicker's scrolling row —
  // there are only ever three options here, so there's nothing to scroll to,
  // and `flex: 1` on each chip turns the row into a proper segmented control
  // spanning the same width the label line above it does.
  tierRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  tierChip: {
    flex: 1,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tierChipSelected: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  tierChipPressed: {
    opacity: 0.7,
  },
  tierChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  tierChipLabelSelected: {
    color: colors.white,
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
  // Both Pressables here had no press feedback at all — a plain color-swap
  // dim, matching the fade TouchableOpacity gives ScheduleBlockSheet's own
  // Cancel/Save pair so every sheet in this flow feels equally responsive.
  editButtonPressed: {
    opacity: 0.7,
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
  deleteButtonPressed: {
    opacity: 0.7,
  },
  deleteText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.destructive,
  },
});
