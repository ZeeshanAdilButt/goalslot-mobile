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
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { updateGoalSchema, type Goal, type UpdateGoalInput } from "@goalslot/shared";

import { apiClient } from "../lib/api-client";
import { goalQueries } from "../lib/queries";
import { queryClient } from "../lib/query-client";

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

/** Loose YYYY-MM-DD check — good enough to catch typos before they hit the server. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  const snapPoints = useMemo(() => ["70%"], []);

  const parsedTargetHours = Number(targetHours);
  const deadlineValid = deadline.trim().length === 0 || DATE_PATTERN.test(deadline.trim());
  const canSubmit =
    !isSubmitting &&
    goal !== null &&
    title.trim().length > 0 &&
    category.trim().length > 0 &&
    Number.isFinite(parsedTargetHours) &&
    parsedTargetHours >= 1 &&
    deadlineValid;

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

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
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Edit goal</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <BottomSheetTextInput
            style={styles.input}
            placeholder="What do you want to work toward?"
            value={title}
            onChangeText={setTitle}
            accessibilityLabel="Goal title"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <BottomSheetTextInput
            style={styles.input}
            placeholder="e.g. Fitness"
            value={category}
            onChangeText={setCategory}
            accessibilityLabel="Goal category"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Target hours</Text>
          <BottomSheetTextInput
            style={styles.input}
            placeholder="e.g. 20"
            value={targetHours}
            onChangeText={setTargetHours}
            keyboardType="numeric"
            accessibilityLabel="Target hours"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Deadline (YYYY-MM-DD, optional)</Text>
          <BottomSheetTextInput
            style={styles.input}
            placeholder="2026-12-31"
            value={deadline}
            onChangeText={setDeadline}
            accessibilityLabel="Goal deadline"
          />
          {!deadlineValid ? <Text style={styles.fieldError}>Use YYYY-MM-DD format.</Text> : null}
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

        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Save goal changes"
        >
          <Text style={styles.submitText}>{isSubmitting ? "Saving…" : "Save changes"}</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 8, default: 10 }),
    fontSize: 16,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSwatchSelected: {
    borderColor: "#0F172A",
  },
  fieldError: {
    color: "#B3261E",
    fontSize: 12,
  },
  error: {
    color: "#B3261E",
    fontSize: 13,
  },
  submitButton: {
    backgroundColor: "#1F2933",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
});
