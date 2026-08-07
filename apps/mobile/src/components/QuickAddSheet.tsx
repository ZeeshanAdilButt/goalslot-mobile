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

  const snapPoints = useMemo(() => ["45%"], []);
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
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{copy.title}</Text>

        <BottomSheetTextInput
          style={styles.input}
          placeholder={copy.placeholder}
          value={title}
          onChangeText={setTitle}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        {kind === "slot" ? (
          <View style={styles.dayRow}>
            {DAY_LABELS.map((label, index) => (
              <TouchableOpacity
                key={label}
                style={[styles.dayChip, index === dayOfWeek && styles.dayChipSelected]}
                onPress={() => setDayOfWeek(index)}
              >
                <Text style={[styles.dayChipText, index === dayOfWeek && styles.dayChipTextSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitText}>{isSubmitting ? "Adding…" : copy.submitLabel}</Text>
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
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 8, default: 10 }),
    fontSize: 16,
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  dayChipSelected: {
    backgroundColor: "#1F2933",
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  dayChipTextSelected: {
    color: "#FFFFFF",
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
