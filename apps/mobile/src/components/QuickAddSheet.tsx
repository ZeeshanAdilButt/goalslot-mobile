// Container/shell for the "true 3-tap add" quick-add flow: open the sheet,
// type a title (+ pick a day, for a slot), submit. All three domains'
// non-title required fields (category, targetHours, start/end time — see
// packages/shared/src/validation/{goal,schedule}.ts) get sane defaults
// inside `useQuickAdd`, never surfaced here. Wiring this sheet into a
// screen (an add button, a ref, the actual "where does it live" decision)
// is the next task's job — this component only needs to be complete, typed,
// and importable.
//
// Needs `GestureHandlerRootView` wrapping the app root and a
// `BottomSheetModalProvider` above it in the tree (both wired into
// app/_layout.tsx) — @gorhom/bottom-sheet's modal variant doesn't render
// without the provider.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { useQuickAdd, type QuickAddInput } from "../hooks/useQuickAdd";
import { hapticLight } from "../lib/haptics";
import { useAnalytics } from "../providers/growth-provider";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export type QuickAddKind = "goal" | "task" | "slot";

export interface QuickAddSheetProps {
  kind: QuickAddKind;
}

const COPY: Record<QuickAddKind, { title: string; placeholder: string; submitLabel: string }> = {
  goal: { title: "New goal", placeholder: "What do you want to work toward?", submitLabel: "Add goal" },
  task: { title: "New task", placeholder: "What needs doing?", submitLabel: "Add task" },
  slot: { title: "New time slot", placeholder: "What's this block for?", submitLabel: "Add slot" },
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Exposes the underlying `BottomSheetModal` instance's `present()`/
 * `dismiss()` (and the rest of its imperative API) to whatever screen holds
 * the ref — the idiomatic @gorhom/bottom-sheet pattern, so a caller doesn't
 * need a bespoke ref type to open/close this.
 */
export const QuickAddSheet = forwardRef<BottomSheetModal, QuickAddSheetProps>(function QuickAddSheet(
  { kind },
  ref,
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);

  const analytics = useAnalytics();
  const { submit, isSubmitting, error } = useQuickAdd();

  const [title, setTitle] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(() => new Date().getDay());
  const [isTitleFocused, setIsTitleFocused] = useState(false);

  const snapPoints = useMemo(() => ["50%"], []);
  const copy = COPY[kind];
  const canSubmit = title.trim().length > 0 && !isSubmitting;

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index >= 0) {
        hapticLight();
        analytics.track({ name: "quickAddOpened", payload: { kind } });
      }
    },
    [analytics, kind],
  );

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    const trimmedTitle = title.trim();
    const input: QuickAddInput =
      kind === "slot" ? { kind, title: trimmedTitle, dayOfWeek } : { kind, title: trimmedTitle };

    try {
      await submit(input);
      setTitle("");
      sheetRef.current?.dismiss();
    } catch {
      // useQuickAdd already recorded `error` for display below; keep the
      // sheet open so the user can retry without retyping the title.
    }
  }, [canSubmit, dayOfWeek, kind, submit, title]);

  const handleCancel = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{copy.title}</Text>

        <BottomSheetTextInput
          style={[styles.input, isTitleFocused && styles.inputFocused]}
          placeholder={copy.placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={title}
          onChangeText={setTitle}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          onFocus={() => setIsTitleFocused(true)}
          onBlur={() => setIsTitleFocused(false)}
          accessibilityLabel={copy.title}
        />

        {kind === "slot" ? (
          <View style={styles.dayRow}>
            {DAY_LABELS.map((label, index) => (
              <TouchableOpacity
                key={label}
                style={[styles.dayChip, index === dayOfWeek && styles.dayChipSelected]}
                onPress={() => setDayOfWeek(index)}
                accessibilityRole="button"
                accessibilityLabel={`Set day to ${label}`}
                accessibilityState={{ selected: index === dayOfWeek }}
              >
                <Text style={[styles.dayChipText, index === dayOfWeek && styles.dayChipTextSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

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
            accessibilityLabel={copy.submitLabel}
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.submitText}>{isSubmitting ? "Adding…" : copy.submitLabel}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
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
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
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
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  dayChipSelected: {
    backgroundColor: colors.foreground,
  },
  dayChipText: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  dayChipTextSelected: {
    color: colors.white,
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
    paddingVertical: spacing.md - 2,
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
    paddingVertical: spacing.md - 2,
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
