// Wires the Android hardware/gesture back button to a BottomSheetModal.
//
// @gorhom/bottom-sheet (the version pinned in package.json, 5.2.14 — checked
// against node_modules/@gorhom/bottom-sheet/src, which has no `BackHandler`
// or `hardwareBackPress` reference anywhere in the package) does NOT
// register its own Android back handler. That's a real gap in the library,
// not a misconfiguration on our side: nothing about backdropComponent,
// enableDismissOnClose, or enablePanDownToClose changes it. Without this
// hook, pressing back while a sheet is open falls through to whatever the
// screen underneath does with it — usually leaving the whole app, since
// every sheet here opens over a root tab screen with nowhere further back
// to go. Confirmed empirically: every BottomSheetModal in this app
// (QuickAddSheet, ScheduleBlockSheet, EditGoalSheet, EditTaskSheet,
// BlockDetailSheet, NewConversationSheet) had this same gap — one shared
// missing piece, not six separate bugs.
//
// Shape follows @gorhom/bottom-sheet's own example app
// (example/src/screens/withBackHandler/index.tsx), the pattern the library's
// author recommends for exactly this: track the sheet's current index and
// only intercept `hardwareBackPress` while it's actually open (index > -1),
// so a closed-but-mounted sheet never swallows back presses meant for the
// screen underneath. When it does intercept, it calls `dismiss()` (not
// `close()`) so the sheet unmounts the same way tapping the backdrop or
// Cancel does, and returns `true` to stop the event from propagating any
// further — the difference between "hide the popup" and "leave the app".
import { useCallback, useRef } from "react";
import { BackHandler, type NativeEventSubscription } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

/**
 * @param sheetRef The same ref passed as `ref` to the `BottomSheetModal`.
 * @returns `handleSheetPositionChange`, a callback to pass through to the
 * sheet's `onChange` prop (or to call from inside an existing one — see
 * QuickAddSheet, the one sheet in this app that already had its own
 * `onChange` for other reasons).
 */
export function useBottomSheetBackHandler(sheetRef: React.RefObject<BottomSheetModal | null>) {
  const backHandlerSubscriptionRef = useRef<NativeEventSubscription | null>(null);

  const handleSheetPositionChange = useCallback(
    (index: number) => {
      const isOpen = index >= 0;

      if (isOpen && !backHandlerSubscriptionRef.current) {
        backHandlerSubscriptionRef.current = BackHandler.addEventListener("hardwareBackPress", () => {
          sheetRef.current?.dismiss();
          // Stops the event here — without `true` it falls through to the
          // default handler, which is exactly the "goes outside the app"
          // behavior this hook exists to prevent.
          return true;
        });
      } else if (!isOpen && backHandlerSubscriptionRef.current) {
        backHandlerSubscriptionRef.current.remove();
        backHandlerSubscriptionRef.current = null;
      }
    },
    [sheetRef],
  );

  return { handleSheetPositionChange };
}
