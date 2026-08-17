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

import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ComponentRef } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { useQuickAdd, type QuickAddInput } from "../hooks/useQuickAdd";
import { useBottomSheetBackHandler } from "../hooks/useBottomSheetBackHandler";
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

  const analytics = useAnalytics();
  const { submit, isSubmitting, error } = useQuickAdd();

  const [title, setTitle] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(() => new Date().getDay());
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const titleRef = useRef<ComponentRef<typeof BottomSheetTextInput>>(null);
  const copy = COPY[kind];
  const canSubmit = title.trim().length > 0 && !isSubmitting;

  const handleSheetChange = useCallback(
    (index: number) => {
      // Keeps the Android back-button listener registered exactly while this
      // sheet is open — see useBottomSheetBackHandler's header.
      handleSheetPositionChange(index);

      if (index >= 0) {
        hapticLight();
        analytics.track({ name: "quickAddOpened", payload: { kind } });
        // Focus only once the sheet has settled. With `autoFocus` the keyboard
        // opened while the sheet was still animating in, so the sheet measured
        // against the pre-resize window height and came to rest underneath it.
        titleRef.current?.focus();
      }
    },
    [analytics, handleSheetPositionChange, kind],
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
    // Sized by its content rather than a fixed "50%" snap point. The fixed
    // point anchored the sheet halfway down the FULL screen, which is exactly
    // where the soft keyboard sits, so on Android the whole form ended up
    // behind it ("that new time slot is hiding under keyboard"). A
    // content-height sheet sits on the bottom of whatever space is left once
    // the window resizes for the keyboard, which is what BlockDetailSheet
    // already does without the problem.
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      // adjustPan, NOT adjustResize — and this is the whole fix for "the
      // keyboard covers the sheet" on Android. The prop does not set the
      // native window flag; it tells @gorhom/bottom-sheet *who* is responsible
      // for moving the sheet clear of the keyboard. Passing "adjustResize"
      // opts the library OUT of doing anything: in that mode BottomSheet.tsx
      // forces `heightWithinContainer = 0` and returns from its keyboard
      // reaction without repositioning, on the assumption that the OS already
      // shrank the window under it.
      //
      // It doesn't. This app runs edge-to-edge — android/gradle.properties
      // sets `edgeToEdgeEnabled=true`, and RN enables it unconditionally
      // anyway once the app targets SDK 35+ (WindowUtil.updateEdgeToEdgeFeatureFlag
      // -> WindowCompat.setDecorFitsSystemWindows(window, false)). With
      // decor-fits-system-windows off, Android ignores
      // `android:windowSoftInputMode="adjustResize"`; the IME is reported as
      // an inset and the window keeps its full height. So neither the OS nor
      // the library moved anything, and the sheet sat at the bottom of a
      // full-height window with the keyboard drawn straight over it — no sheet
      // visible at all, which is exactly what the device screenshot showed.
      //
      // "adjustPan" is the library's own default and puts it back in charge:
      // it offsets the sheet by the keyboard height from RN's keyboardDidShow,
      // which ReactRootView derives from real `WindowInsetsCompat.Type.ime()`
      // insets and is therefore correct under edge-to-edge. It also stays
      // correct if the window ever *does* resize (a non-edge-to-edge build):
      // the container then measures shorter, `containerOffset.bottom` grows by
      // the same amount, and the computed offset cancels back to ~0 rather
      // than double-lifting. JS-only change — no native rebuild needed.
      android_keyboardInputMode="adjustPan"
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{copy.title}</Text>

        <BottomSheetTextInput
          ref={titleRef}
          style={[styles.input, isTitleFocused && styles.inputFocused]}
          placeholder={copy.placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={title}
          onChangeText={setTitle}
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
    // No `flex: 1` — with enableDynamicSizing the sheet measures this view to
    // decide its height, and a flexed child reports the full container instead
    // of its own content, which collapses the sizing back to a full-height sheet.
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
    borderRadius: radii.lg,
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
