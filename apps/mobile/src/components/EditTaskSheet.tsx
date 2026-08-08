// Edit sheet for an existing task: title, category, due date, estimated
// minutes. Mirrors QuickAddSheet's @gorhom/bottom-sheet shell, but (like
// EditGoalSheet) exposes a custom present(task)/dismiss() imperative handle
// instead of forwarding the raw BottomSheetModal ref, since tasks.tsx's
// row-tap flow needs to seed the form from a specific Task.
//
// Submit follows the same optimistic-patch -> apiClient.tasks.update() ->
// invalidate-on-success / rollback-on-failure shape as tasks.tsx's
// handleReschedule (patch the cache, call the live endpoint, invalidate on
// success, restore the pre-patch snapshot on failure) rather than
// src/hooks/useQuickAdd.ts's create-flow pattern.
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

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { getLocalDateString, updateTaskSchema, type Task, type UpdateTaskInput } from "@goalslot/shared";

import { apiClient } from "../lib/api-client";
import { taskQueries } from "../lib/queries";
import { queryClient } from "../lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

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

export const EditTaskSheet = forwardRef<EditTaskSheetRef, object>(function EditTaskSheet(_props, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [task, setTask] = useState<Task | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [dueDate, setDueDate] = useState<string | undefined>(undefined);
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
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  const snapPoints = useMemo(() => ["65%"], []);

  const trimmedMinutes = estimatedMinutes.trim();
  const parsedMinutes = trimmedMinutes.length > 0 ? Number(trimmedMinutes) : undefined;
  const minutesValid = parsedMinutes === undefined || (Number.isFinite(parsedMinutes) && parsedMinutes >= 1);
  const canSubmit = !isSubmitting && task !== null && title.trim().length > 0 && minutesValid;

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
    } catch {
      queryClient.setQueryData(listKey, previous);
      Alert.alert("Couldn't save task", "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, category, dueDate, parsedMinutes, task, title]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
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
          </View>
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
    borderRadius: radii.md,
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
  fieldError: {
    color: colors.destructive,
    fontSize: 12,
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
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
    borderRadius: radii.md,
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
    borderRadius: radii.md,
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
