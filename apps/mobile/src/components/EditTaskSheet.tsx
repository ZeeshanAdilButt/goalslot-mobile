// Edit sheet for an existing task: title, category, due date, estimated
// minutes. Mirrors QuickAddSheet's @gorhom/bottom-sheet shell, but (like
// EditGoalSheet) exposes a custom present(task)/dismiss() imperative handle
// instead of forwarding the raw BottomSheetModal ref, since tasks.tsx's
// row-tap flow needs to seed the form from a specific Task.
//
// Submit follows the same optimistic-patch -> apiClient.tasks.update() ->
// invalidate-on-success shape as tasks.tsx's handleReschedule (patch the
// cache, call the live endpoint, invalidate on success). On a failure that
// looks like "no server response" (offline/timeout), the patch stays
// applied (tagged `pendingSync: true`) and queues to the offline outbox via
// the already-registered "task-update" operation — see
// src/lib/offline.ts's `queueOfflineEdit`. Only a genuine rejection (the
// server answered and said no) restores the pre-patch snapshot.
//
// Due date uses the same quick-pick buttons as tasks.tsx's reschedule sheet
// (RESCHEDULE_OPTIONS: Today/Tomorrow/Next week), instead of a free-text
// date field — a task's due date is a near-term scheduling choice, the same
// use case that flow already covers, so reusing its exact interaction model
// (rather than inventing a second date UI) is the better fit here. (Goal
// deadlines, by contrast, are often months out, which is why EditGoalSheet
// uses a plain YYYY-MM-DD text field instead.)
//
// No "clear due date" option: updateTaskSchema's `dueDate` is a plain
// optional string with no null/clear sentinel (mirrors the live API DTO),
// so there's no payload shape this form could send that would actually
// unset an existing due date server-side — same acknowledged gap as
// EditGoalSheet's deadline field. A chip that looked like it cleared the
// date but silently no-op'd on submit would be worse than not offering it.
//
// A fourth "Custom…" chip sits alongside those three for the gap they
// don't cover: a due date further out than a week, or a specific day with
// no fixed offset from today. Tapping it reveals `DatePicker` (src/
// components/ui/DatePicker.tsx, the same month-grid primitive used
// elsewhere in the app) below the chip row. This doesn't undercut the
// "near-term scheduling choice" reasoning above — it's opt-in and sits
// behind an extra tap, so the three quick picks stay the fast path and
// this is only reached when they genuinely don't fit.
//
// The picker's `minDate` is pinned to today, not to the task's current due
// date: a *newly* picked date shouldn't be allowed to land in the past,
// but DatePicker's disabled-day styling only blocks taps on days before
// `minDate` — it doesn't touch the selected-day styling — so reopening
// this sheet on an already-overdue task still renders that past date as
// selected instead of looking cleared or broken.
//
// If `dueDate` doesn't land on any of the three presets when the sheet
// opens (a previously custom-picked date, or one set some other way),
// none of the three preset chips claims the selected look — same
// exact-match check the presets already do — and instead the Custom chip
// shows selected with that date as its label, with the calendar
// auto-expanded so the value isn't hidden behind a collapsed row.

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { getLocalDateString, updateTaskSchema, type Task, type UpdateTaskInput } from "@goalslot/shared";

import { apiClient, notify } from "../lib/api-client";
import { queueOfflineEdit } from "../lib/offline";
import { taskQueries } from "../lib/queries";
import { queryClient } from "../lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";
import { parseDateKey } from "@/components/ui/calendar-math";

export interface EditTaskSheetRef {
  present: (task: Task) => void;
  dismiss: () => void;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const DUE_DATE_OPTIONS: Array<{ label: string; daysFromToday: number }> = [
  { label: "Today", daysFromToday: 0 },
  { label: "Tomorrow", daysFromToday: 1 },
  { label: "Next week", daysFromToday: 7 },
];

/** Whether `date` ("YYYY-MM-DD") lands exactly on one of the three
 *  quick-pick presets above. Drives both whether the Custom chip (rather
 *  than a preset chip) shows as the active due-date control, and whether
 *  the calendar should auto-expand when the sheet opens on a value none
 *  of the presets cover. */
function isPresetDueDate(date: string | undefined): boolean {
  if (date === undefined) return false;
  return DUE_DATE_OPTIONS.some((option) => date === getLocalDateString(addDays(new Date(), option.daysFromToday)));
}

/** "YYYY-MM-DD" -> "Aug 30" for the Custom chip's label once a non-preset
 *  date is selected. Goes through `parseDateKey` + a local `Date(y, m, d)`
 *  rather than `new Date(dateString)` directly — the latter parses
 *  "YYYY-MM-DD" as UTC midnight, which `toLocaleDateString` can then
 *  render as the previous day in negative-UTC-offset timezones. */
function formatCustomDueDate(date: string): string {
  const { year, month, day } = parseDateKey(date);
  return new Date(year, month, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const EditTaskSheet = forwardRef<EditTaskSheetRef, object>(function EditTaskSheet(_props, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  // See the hook's own header for why this is needed at all — the library
  // doesn't wire Android's hardware back button to the sheet on its own.
  const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);
  const [task, setTask] = useState<Task | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [dueDate, setDueDate] = useState<string | undefined>(undefined);
  // Whether the Custom chip's calendar is expanded. Toggled by tapping that
  // chip; also set on present() so a non-preset dueDate doesn't open the
  // sheet with its due date invisible behind a collapsed row.
  const [customDatePickerOpen, setCustomDatePickerOpen] = useState(false);
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"title" | "category" | "estimatedMinutes" | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      present: (t: Task) => {
        setTask(t);
        setTitle(t.title);
        setCategory(t.category ?? "");
        setDueDate(t.dueDate);
        setEstimatedMinutes(t.estimatedMinutes ? String(t.estimatedMinutes) : "");
        setError(null);
        setCustomDatePickerOpen(t.dueDate !== undefined && !isPresetDueDate(t.dueDate));
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  const trimmedMinutes = estimatedMinutes.trim();
  const parsedMinutes = trimmedMinutes.length > 0 ? Number(trimmedMinutes) : undefined;
  const minutesValid = parsedMinutes === undefined || (Number.isFinite(parsedMinutes) && parsedMinutes >= 1);
  const canSubmit = !isSubmitting && task !== null && title.trim().length > 0 && minutesValid;
  // The Custom chip is "selected" precisely when dueDate is set but isn't
  // one of the three presets — mirrors the exact-match check each preset
  // chip already does against dueDate, just inverted across all three.
  const customDueDateSelected = dueDate !== undefined && !isPresetDueDate(dueDate);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const handleCancel = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!task || !canSubmit) return;

    const trimmedTitle = title.trim();
    const trimmedCategory = category.trim();

    let payload: UpdateTaskInput;
    try {
      payload = updateTaskSchema.parse({
        title: trimmedTitle,
        // Omit rather than send "" — an empty category string isn't a
        // meaningful category value, and updateTaskSchema treats the key as
        // optional, so leaving it out is the correct "no category" shape.
        ...(trimmedCategory ? { category: trimmedCategory } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(parsedMinutes !== undefined ? { estimatedMinutes: parsedMinutes } : {}),
      });
    } catch {
      setError("Please check the fields above and try again.");
      return;
    }

    // tasks.tsx's own mutations all patch the single unfiltered list query
    // (taskQueries.taskQueries.list(), no filters) — that's the whole-list
    // view the screen renders from, so match it exactly here.
    const listKey = taskQueries.taskQueries.list();
    const previous = queryClient.getQueryData<Task[]>(listKey);
    queryClient.setQueryData<Task[]>(listKey, (existing) =>
      (existing ?? []).map((t) => (t.id === task.id ? { ...t, ...payload } : t)),
    );

    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.tasks.update(task.id, payload);
      void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
      sheetRef.current?.dismiss();
    } catch (err) {
      const queued = await queueOfflineEdit("task-update", { id: task.id, data: payload }, err);
      if (queued) {
        // The patch above is already applied; just tag it pending instead
        // of rolling it back to `previous`.
        queryClient.setQueryData<Task[]>(listKey, (existing) =>
          (existing ?? []).map((t) => (t.id === task.id ? { ...t, pendingSync: true } : t)),
        );
        notify("Queued — will sync when online", "success");
        sheetRef.current?.dismiss();
      } else {
        queryClient.setQueryData(listKey, previous);
        Alert.alert("Couldn't save task", "Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, category, dueDate, parsedMinutes, task, title]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      // enableDynamicSizing rather than a fixed snapPoints percentage — see
      // QuickAddSheet's header comment: a fixed snap point is measured
      // against the full window height, which on Android is exactly where
      // the soft keyboard then lands, so the sheet's inputs end up hidden
      // behind it. Dynamic sizing measures the actual content and sits on
      // top of whatever space the keyboard leaves, matching
      // ScheduleBlockSheet's already-correct pattern. The expanding custom
      // date picker still renders fine: dynamic sizing re-measures on
      // content change, and everything sits inside a BottomSheetScrollView
      // regardless, so nothing is ever hard-clipped.
      enableDynamicSizing
      onChange={handleSheetPositionChange}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Edit task</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "title" && styles.inputFocused]}
            placeholder="What needs doing?"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
            onFocus={() => setFocusedField("title")}
            onBlur={() => setFocusedField(null)}
            accessibilityLabel="Task title"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "category" && styles.inputFocused]}
            placeholder="e.g. Work"
            placeholderTextColor={colors.mutedForeground}
            value={category}
            onChangeText={setCategory}
            onFocus={() => setFocusedField("category")}
            onBlur={() => setFocusedField(null)}
            accessibilityLabel="Task category"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Estimated minutes</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "estimatedMinutes" && styles.inputFocused]}
            placeholder="e.g. 30"
            placeholderTextColor={colors.mutedForeground}
            value={estimatedMinutes}
            onChangeText={setEstimatedMinutes}
            onFocus={() => setFocusedField("estimatedMinutes")}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
            accessibilityLabel="Estimated minutes"
          />
          {!minutesValid ? <Text style={styles.fieldError}>Must be at least 1 minute.</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Due date</Text>
          <View style={styles.dueDateRow}>
            {DUE_DATE_OPTIONS.map((option) => {
              const optionDate = getLocalDateString(addDays(new Date(), option.daysFromToday));
              const selected = dueDate === optionDate;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[styles.dueDateChip, selected && styles.dueDateChipSelected]}
                  onPress={() => setDueDate(optionDate)}
                  accessibilityRole="button"
                  accessibilityLabel={`Set due date to ${option.label}`}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.dueDateChipText, selected && styles.dueDateChipTextSelected]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.dueDateChip, customDueDateSelected && styles.dueDateChipSelected]}
              onPress={() => setCustomDatePickerOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={
                customDueDateSelected && dueDate
                  ? `Custom due date, ${formatCustomDueDate(dueDate)}`
                  : "Pick a custom due date"
              }
              accessibilityState={{ selected: customDueDateSelected, expanded: customDatePickerOpen }}
            >
              <View style={styles.dueDateChipContent}>
                <Icon
                  name="schedule"
                  size={14}
                  color={customDueDateSelected ? colors.primaryForeground : colors.mutedForeground}
                />
                <Text style={[styles.dueDateChipText, customDueDateSelected && styles.dueDateChipTextSelected]}>
                  {customDueDateSelected && dueDate ? formatCustomDueDate(dueDate) : "Custom…"}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          {customDatePickerOpen ? (
            <View style={styles.customDatePicker}>
              <DatePicker value={dueDate} onChange={setDueDate} minDate={getLocalDateString(new Date())} />
            </View>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Save task changes"
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.submitText}>{isSubmitting ? "Saving…" : "Save changes"}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetScrollView>
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    // radii.lg (control role, 12px) — an input is a control the same as the
    // Cancel/Save buttons below, not a chip; radii.md (8, chip role) read as
    // a smaller-radius mismatch against every other control-shaped surface
    // in this sheet. Matches ScheduleBlockSheet's own input, fixed for the
    // same reason.
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.select({ ios: spacing.md, android: spacing.sm, default: spacing.sm + spacing.xxs }),
    fontSize: 16,
    color: colors.foreground,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  dueDateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  dueDateChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md + spacing.xxs,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  dueDateChipSelected: {
    backgroundColor: colors.primary,
  },
  dueDateChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  dueDateChipTextSelected: {
    color: colors.primaryForeground,
  },
  dueDateChipContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  customDatePicker: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.sm,
  },
  fieldError: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
  error: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  cancelButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  cancelText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  submitButton: {
    flex: 1,
    minHeight: minTouchTarget,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
