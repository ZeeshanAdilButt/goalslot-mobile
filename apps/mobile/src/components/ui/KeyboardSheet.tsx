// Thin wrapper around @gorhom/bottom-sheet's BottomSheetModal that defaults
// the three props a sheet needs for its own text inputs to stay clear of the
// Android soft keyboard: `keyboardBehavior="interactive"`,
// `keyboardBlurBehavior="restore"`, and `android_keyboardInputMode="adjustPan"`.
// Without the last one, the sheet falls back to the OS's default
// `adjustResize`, which this app's edge-to-edge Android build ignores — see
// QuickAddSheet.tsx's header comment for the full mechanism. That one prop
// has been hand-copied onto every sheet and missed five separate times
// (QuickAddSheet, EditTaskSheet, EditGoalSheet, ScheduleBlockSheet,
// AssignInstructionSheet all shipped without it at some point) because
// nothing forced the three props to travel together. Building a sheet on top
// of `KeyboardSheet` instead of `BottomSheetModal` directly makes that
// impossible by construction — a new sheet gets the fix for free, and can
// still override any of the three individually if it has a real reason to.
//
// A sheet with no text input inside it (a pure action list or menu) has
// nothing for the keyboard to cover and can keep using `BottomSheetModal`
// directly.
import { forwardRef } from "react";
import { BottomSheetModal, type BottomSheetModalProps } from "@gorhom/bottom-sheet";

export type KeyboardSheetProps = BottomSheetModalProps;

export const KeyboardSheet = forwardRef<BottomSheetModal, KeyboardSheetProps>(function KeyboardSheet(
  { keyboardBehavior = "interactive", keyboardBlurBehavior = "restore", android_keyboardInputMode = "adjustPan", ...rest },
  ref,
) {
  return (
    <BottomSheetModal
      ref={ref}
      keyboardBehavior={keyboardBehavior}
      keyboardBlurBehavior={keyboardBlurBehavior}
      android_keyboardInputMode={android_keyboardInputMode}
      {...rest}
    />
  );
});
