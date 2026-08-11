// Edit sheet for an existing goal: title, category, target hours, deadline,
// status, color. Mirrors QuickAddSheet's @gorhom/bottom-sheet shell (same
// backdrop / keyboard-behavior props, same input styling), but goals.tsx's
// row-tap flow needs to hand this component a specific Goal to edit rather
// than "open blank" — so instead of forwarding the raw BottomSheetModal ref
// (QuickAddSheet's shape, whose present() takes no args) this exposes a
// small custom imperative handle: present(goal) seeds the form from that
// goal and opens the sheet, dismiss() closes it without saving.
//
// Field set matches dw-time-web's goal-modal.tsx column layout, minus the two
// things that need editors mobile doesn't have yet (rich-text description,
// label autocomplete) — see the handover. Status is included because
// goal-modal.tsx renders that select whenever it is editing rather than
// creating, and it's the only way to pause or un-pause a goal; without it
// the Paused tab on goals.tsx would be a read-only dead end.
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

import { GOAL_STATUS_OPTIONS, updateGoalSchema, type Goal, type GoalStatus, type UpdateGoalInput } from "@goalslot/shared";

import { apiClient } from "../lib/api-client";
import { goalQueries } from "../lib/queries";
import { queryClient } from "../lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";
import { formatDeadlineLong, GoalColorPicker, toDeadlineKey } from "@/components/goals";
import { DEFAULT_SWATCH, SegmentedControl } from "@/components/lists";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";

export interface EditGoalSheetRef {
  present: (goal: Goal) => void;
  dismiss: () => void;
}

export const EditGoalSheet = forwardRef<EditGoalSheetRef, object>(function EditGoalSheet(_props, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [goal, setGoal] = useState<Goal | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [targetHours, setTargetHours] = useState("");
  /** Always "" or a canonical "YYYY-MM-DD" key — never a raw API instant. */
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<GoalStatus>("ACTIVE");
  const [color, setColor] = useState<string>(DEFAULT_SWATCH);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"title" | "category" | "targetHours" | null>(null);
  // Calendar grid stays collapsed behind a summary row by default — it's tall
  // enough (full month, 6 possible rows) that showing it inline unconditionally
  // would push title/category/hours/color below the fold on every open, even
  // though most edits don't touch the deadline.
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);

  /**
   * The calendar day currently PERSISTED on this goal, normalised the same
   * way. Kept separately from the editable `deadline` so the form can tell
   * "the user cleared a saved deadline" (which the API can't express — see
   * the notice below) apart from "the user cleared a pick they hadn't saved".
   */
  const savedDeadlineKey = useMemo(() => toDeadlineKey(goal?.deadline), [goal?.deadline]);

  useImperativeHandle(
    ref,
    () => ({
      present: (g: Goal) => {
        setGoal(g);
        setTitle(g.title);
        setCategory(g.category);
        setTargetHours(String(g.targetHours));
        // `g.deadline` arrives as a full ISO instant (the API column is a
        // Prisma DateTime), not the "YYYY-MM-DD" key DatePicker and the label
        // formatter both expect. Feeding it in raw produced the literal text
        // "Invalid Date" in the summary row and left the calendar with no day
        // highlighted, because `value === cell.key` could never match. web
        // normalises at exactly this boundary: goal-modal.tsx:118 —
        // `deadline: goal.deadline ? goal.deadline.split('T')[0] : ''`.
        setDeadline(toDeadlineKey(g.deadline) ?? "");
        setStatus(g.status);
        setColor(g.color || DEFAULT_SWATCH);
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
  // No format/validity check needed for `deadline`: it is only ever set by
  // DatePicker (always a well-formed "YYYY-MM-DD"), by `toDeadlineKey` on
  // open, or cleared to "" by the Clear action below.
  const canSubmit =
    !isSubmitting &&
    goal !== null &&
    title.trim().length > 0 &&
    category.trim().length > 0 &&
    Number.isFinite(parsedTargetHours) &&
    parsedTargetHours >= 1;

  /**
   * True only in the one case where the deadline control lies: the goal has a
   * deadline on the server and the user has cleared it locally. There is no
   * wire representation for "remove this deadline" —
   * dw-time-api/src/modules/goals/goals.service.ts:252 is
   * `deadline: dto.deadline ? new Date(dto.deadline) : undefined`, and Prisma
   * reads `undefined` as "leave the column alone". Web has the same gap and
   * simply blanks its date input; on mobile the Clear action reads as a
   * committed destructive edit, so the form says what will actually happen
   * rather than letting the value silently reappear on the next fetch.
   */
  const clearingSavedDeadline = savedDeadlineKey !== null && deadline === "";

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const handleCancel = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  /** Editing any field clears a stale validation message. */
  const clearError = useCallback(() => setError(null), []);

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
        status,
        color,
        // Only sent when non-empty — see `clearingSavedDeadline` above for
        // why an omitted key can't clear a stored deadline, and what the form
        // tells the user about it.
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
    // join-row shape) — and this form only ever edits the fields below anyway.
    const goalPatch: Partial<Goal> = {
      title: payload.title,
      category: payload.category,
      targetHours: payload.targetHours,
      status: payload.status,
      color: payload.color,
      ...(payload.deadline !== undefined ? { deadline: payload.deadline } : {}),
    };

    // The goal's status BEFORE this edit tells us which goals.tsx tab (and so
    // which cached list query) it currently lives under — same filters shape
    // as that screen's `{ status: tab }`.
    const listKey = goalQueries.goalQueries.list({ status: goal.status });
    const previous = queryClient.getQueryData<Goal[]>(listKey);
    const statusChanged = payload.status !== undefined && payload.status !== goal.status;

    queryClient.setQueryData<Goal[]>(listKey, (existing) =>
      statusChanged
        ? // Now the sheet can change status, an edit can move a goal to a
          // different tab. Patching it in place would leave a completed goal
          // sitting in the Active list until the invalidation below landed —
          // it has to drop out of this list the same way handleComplete drops
          // it. The destination tab is reconciled from the server.
          (existing ?? []).filter((g) => g.id !== goal.id)
        : (existing ?? []).map((g) => (g.id === goal.id ? { ...g, ...goalPatch } : g)),
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
  }, [canSubmit, category, color, deadline, goal, parsedTargetHours, status, title]);

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
            onChangeText={(next) => {
              clearError();
              setTitle(next);
            }}
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
            onChangeText={(next) => {
              clearError();
              setCategory(next);
            }}
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
            onChangeText={(next) => {
              clearError();
              setTargetHours(next);
            }}
            onFocus={() => setFocusedField("targetHours")}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
            accessibilityLabel="Target hours"
            accessibilityHint="Must be at least 1"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Deadline (optional)</Text>
          <TouchableOpacity
            style={styles.deadlineRow}
            onPress={() => setDeadlinePickerOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={
              deadline ? `Change deadline, currently ${formatDeadlineLong(deadline)}` : "Set a deadline"
            }
            accessibilityState={{ expanded: deadlinePickerOpen }}
          >
            <Icon name="schedule" size={18} color={colors.mutedForeground} />
            <Text style={styles.deadlineRowText}>{deadline ? formatDeadlineLong(deadline) : "No deadline"}</Text>
            <Icon name={deadlinePickerOpen ? "chevron-down" : "chevron"} size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          {clearingSavedDeadline ? (
            <View style={styles.deadlineWarning}>
              <Icon name="alert" size={14} color={colors.warning} />
              <Text style={styles.deadlineWarningText}>
                Deadlines can&apos;t be removed from the app yet — saving now keeps{" "}
                {formatDeadlineLong(savedDeadlineKey)}. Pick a different date to change it.
              </Text>
            </View>
          ) : null}

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
              <DatePicker
                value={deadline || null}
                onChange={(next) => {
                  clearError();
                  setDeadline(next);
                }}
              />
              {deadline ? (
                <TouchableOpacity
                  style={styles.clearDeadlineButton}
                  onPress={() => setDeadline("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear deadline"
                >
                  <Icon name="calendar-off" size={16} color={colors.destructive} />
                  <Text style={styles.clearDeadlineText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Status</Text>
          {/* goal-modal.tsx:302-317 renders this select only when editing an
              existing goal, which is the only mode this sheet has. */}
          <SegmentedControl options={GOAL_STATUS_OPTIONS} value={status} onChange={setStatus} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Color</Text>
          <GoalColorPicker value={color} onChange={setColor} />
        </View>

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityHint="Closes without saving"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Save goal changes"
            accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
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
  deadlineWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.warningMuted,
  },
  deadlineWarningText: {
    ...typography.bodySmall,
    color: colors.foreground,
    flex: 1,
    lineHeight: 17,
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
