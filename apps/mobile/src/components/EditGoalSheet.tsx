// Edit sheet for an existing goal: title, category, target hours, deadline,
// color. Mirrors QuickAddSheet's @gorhom/bottom-sheet shell (same backdrop /
// keyboard-behavior props, same input styling), but goals.tsx's row-tap flow
// needs to hand this component a specific Goal to edit rather than "open
// blank" — so instead of forwarding the raw BottomSheetModal ref
// (QuickAddSheet's shape, whose present() takes no args) this exposes a
// small custom imperative handle: present(goal) seeds the form from that
// goal and opens the sheet, dismiss() closes it without saving.
//
// Submit follows the same optimistic-patch -> apiClient.goals.update() ->
// invalidate-on-success / rollback-on-failure shape as goals.tsx's
// handleComplete/deleteGoal, not src/hooks/useQuickAdd.ts's create-flow
// pattern (no offline outbox enqueue on failure here, same as those two
// existing mutations).

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { updateGoalSchema, type Goal, type UpdateGoalInput } from "@goalslot/shared";

import { apiClient } from "../lib/api-client";
import { goalQueries } from "../lib/queries";
import { queryClient } from "../lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";

export interface EditGoalSheetRef {
  present: (goal: Goal) => void;
  dismiss: () => void;
}

// Fixed swatch palette for the goal's color dot — no color-picker library is
// installed, and QuickAddSheet's PLACEHOLDER_COLOR (#94A3B8) is the only
// other color constant in this app, so this is a small standalone set rather
// than reusing goal.ts's LABEL_COLORS (those are pastel label backgrounds
// with a separate textColor, a different design token than a solid dot).
const COLOR_OPTIONS = ["#1F2933", "#B3261E", "#0F766E", "#7C3AED", "#EA580C", "#0EA5E9", "#DB2777", "#65A30D"];

/**
 * Formats a "YYYY-MM-DD" key as a friendly label, e.g. "Dec 31, 2026". Parsed
 * via the date parts rather than `new Date(dateStr)` — the bare-date form is
 * parsed as UTC midnight, which renders as the previous day for anyone
 * behind UTC (same trap SessionHistory.tsx's formatDayHeading documents, and
 * the same `{ month, day, year }` option shape it and reports/aggregate.ts
 * use for other date labels in this app).
 */
function formatDeadlineLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const EditGoalSheet = forwardRef<EditGoalSheetRef, object>(function EditGoalSheet(_props, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [goal, setGoal] = useState<Goal | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [targetHours, setTargetHours] = useState("");
  const [deadline, setDeadline] = useState("");
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"title" | "category" | "targetHours" | null>(null);
  // Calendar grid stays collapsed behind a summary row by default — it's tall
  // enough (full month, 6 possible rows) that showing it inline unconditionally
  // would push title/category/hours/color below the fold on every open, even
  // though most edits don't touch the deadline.
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      present: (g: Goal) => {
        setGoal(g);
        setTitle(g.title);
        setCategory(g.category);
        setTargetHours(String(g.targetHours));
        setDeadline(g.deadline ?? "");
        setColor(g.color || COLOR_OPTIONS[0]);
        setError(null);
        setDeadlinePickerOpen(false);
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  // Bumped from 70% -> 85% so the calendar grid (month header + 6 possible
  // week rows) has room to show without forcing a scroll on every open when
  // the deadline row is expanded — content still sits in a
  // BottomSheetScrollView, so nothing is ever hard-clipped, this just cuts
  // how often that scroll is needed.
  const snapPoints = useMemo(() => ["85%"], []);

  const parsedTargetHours = Number(targetHours);
  // No format/validity check needed here anymore: `deadline` is now only
  // ever set by DatePicker (always a well-formed "YYYY-MM-DD") or cleared to
  // "" by the "No deadline" action below, unlike the old free-text field
  // which needed DATE_PATTERN to catch typos.
  const canSubmit =
    !isSubmitting &&
    goal !== null &&
    title.trim().length > 0 &&
    category.trim().length > 0 &&
    Number.isFinite(parsedTargetHours) &&
    parsedTargetHours >= 1;

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
    if (!goal || !canSubmit) return;

    const trimmedTitle = title.trim();
    const trimmedCategory = category.trim();
    const trimmedDeadline = deadline.trim();

    let payload: UpdateGoalInput;
    try {
      payload = updateGoalSchema.parse({
        title: trimmedTitle,
        category: trimmedCategory,
        targetHours: parsedTargetHours,
        color,
        // Only sent when non-empty: an omitted key leaves the server-side
        // deadline untouched on this PATCH-style update rather than clearing
        // it, so a cleared field here can't un-set an existing deadline —
        // an acceptable gap for this pass (same limitation applies to the
        // task sheet's due date).
        ...(trimmedDeadline ? { deadline: trimmedDeadline } : {}),
      });
    } catch {
      setError("Please check the fields above and try again.");
      return;
    }

    // Built explicitly (rather than spreading `payload` itself) because
    // updateGoalSchema's `labels` field (LabelInput[] — {name, color}) is a
    // write-only shape for the create/label-attach flow, structurally
    // incompatible with Goal.labels (GoalLabel[], the server's expanded
    // join-row shape) — and this form only ever edits the four fields below
    // anyway.
    const goalPatch: Partial<Goal> = {
      title: payload.title,
      category: payload.category,
      targetHours: payload.targetHours,
      color: payload.color,
      ...(payload.deadline !== undefined ? { deadline: payload.deadline } : {}),
    };

    // Editing never changes status here, so the goal's current status tells
    // us exactly which goals.tsx tab (and therefore which cached list query)
    // it lives under — same filters shape as goals.tsx's `{ status: tab }`.
    const listKey = goalQueries.goalQueries.list({ status: goal.status });
    const previous = queryClient.getQueryData<Goal[]>(listKey);
    queryClient.setQueryData<Goal[]>(listKey, (existing) =>
      (existing ?? []).map((g) => (g.id === goal.id ? { ...g, ...goalPatch } : g)),
    );

    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.goals.update(goal.id, payload);
      void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      sheetRef.current?.dismiss();
    } catch {
      queryClient.setQueryData(listKey, previous);
      Alert.alert("Couldn't save goal", "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, category, color, deadline, goal, parsedTargetHours, title]);

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
        <Text style={styles.title}>Edit goal</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "title" && styles.inputFocused]}
            placeholder="What do you want to work toward?"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
            onFocus={() => setFocusedField("title")}
            onBlur={() => setFocusedField(null)}
            accessibilityLabel="Goal title"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "category" && styles.inputFocused]}
            placeholder="e.g. Fitness"
            placeholderTextColor={colors.mutedForeground}
            value={category}
            onChangeText={setCategory}
            onFocus={() => setFocusedField("category")}
            onBlur={() => setFocusedField(null)}
            accessibilityLabel="Goal category"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Target hours</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "targetHours" && styles.inputFocused]}
            placeholder="e.g. 20"
            placeholderTextColor={colors.mutedForeground}
            value={targetHours}
            onChangeText={setTargetHours}
            onFocus={() => setFocusedField("targetHours")}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
            accessibilityLabel="Target hours"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Deadline (optional)</Text>
          <TouchableOpacity
            style={styles.deadlineRow}
            onPress={() => setDeadlinePickerOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={deadline ? `Change deadline, currently ${formatDeadlineLabel(deadline)}` : "Set a deadline"}
            accessibilityState={{ expanded: deadlinePickerOpen }}
          >
            <Icon name="schedule" size={18} color={colors.mutedForeground} />
            <Text style={styles.deadlineRowText}>{deadline ? formatDeadlineLabel(deadline) : "No deadline"}</Text>
            <Icon name={deadlinePickerOpen ? "chevron-down" : "chevron"} size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          {deadlinePickerOpen ? (
            <View style={styles.deadlinePicker}>
              {/*
                No `minDate` here: dw-time-web's goal-modal.tsx renders the
                deadline as a plain `<input type="date">` with no `min`
                attribute (src/features/goals/components/goal-modal.tsx,
                ~line 293), and updateGoalSchema's `deadline` is an
                unconstrained optional string (packages/shared/src/
                validation/goal.ts) — so the web form lets you set or keep a
                past deadline on an existing goal, and this picker matches
                that rather than inventing a stricter mobile-only rule.
              */}
              <DatePicker value={deadline || null} onChange={setDeadline} />
              {deadline ? (
                <TouchableOpacity
                  style={styles.clearDeadlineButton}
                  onPress={() => setDeadline("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear deadline"
                >
                  <Icon name="calendar-off" size={16} color={colors.destructive} />
                  <Text style={styles.clearDeadlineText}>No deadline</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Color</Text>
          <View style={styles.colorRow}>
            {COLOR_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.colorSwatch, { backgroundColor: option }, color === option && styles.colorSwatchSelected]}
                onPress={() => setColor(option)}
                accessibilityRole="button"
                accessibilityLabel={`Set goal color to ${option}`}
                accessibilityState={{ selected: color === option }}
              />
            ))}
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
            accessibilityLabel="Save goal changes"
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
  deadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
  },
  deadlineRowText: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  deadlinePicker: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  clearDeadlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget,
    borderRadius: radii.md,
  },
  clearDeadlineText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm + spacing.xxs,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSwatchSelected: {
    borderColor: colors.primary,
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
