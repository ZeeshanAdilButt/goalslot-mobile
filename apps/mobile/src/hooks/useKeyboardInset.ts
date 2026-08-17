// How much of the window the soft keyboard is currently covering, in points.
// 0 whenever the keyboard is down.
//
// This exists because Android does not do it for us. `app.json` sets
// `softwareKeyboardLayoutMode: "resize"`, but this app targets SDK 35+ where
// edge-to-edge is unconditional and the OS IGNORES adjustResize — the window
// keeps its full height, so a ScrollView keeps its full height, and anything
// laid out under the keyboard line is not merely hidden but unreachable: from
// the list's point of view it is already fully on screen, so there is nothing
// to scroll. That is the reported "search hides the lower options under
// keyboard". The same mechanism is written up at four other sites in this
// repo (SettingsSheet, TrackingPicker, coach.tsx, message/[id].tsx), each of
// which worked it out again from scratch.
//
// WHEN TO USE THIS RATHER THAN KeyboardAvoidingView
//
// KeyboardAvoidingView is the right tool when a composer or a button row has
// to be PUSHED UP and stay visible — that is the message thread and Coach,
// and they should keep using it. It works by shrinking (Android `height`) or
// padding (iOS) the container itself.
//
// This hook is the right tool when the thing that needs to change is a
// scrollable list's reachable extent: adding the keyboard's height to a
// `contentContainerStyle` bottom padding leaves the list at full height and
// simply makes the last rows scrollable into the visible region. On an
// absolutely-positioned full-window overlay (SearchOverlay) that distinction
// matters — shrinking the container there relayouts the whole surface and can
// jump the scroll offset, whereas padding the content cannot.
//
// The listener split is the same one useThreadScroll.ts already documents:
// iOS's `keyboardWillShow` fires with the animation so layout travels with
// the keyboard instead of snapping after it lands; Android only has
// `keyboardDidShow`.

import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

const SHOW_EVENT = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE_EVENT = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

/**
 * Height of the soft keyboard in points, or 0 when it is hidden.
 *
 * Typical use — make every row of a list reachable while the keyboard is up:
 *
 * ```tsx
 * const keyboardInset = useKeyboardInset();
 * <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + keyboardInset }]} />
 * ```
 *
 * Add it to an existing bottom padding rather than replacing it, so the list
 * keeps its normal breathing room when the keyboard is down.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(SHOW_EVENT, (event) => {
      // `endCoordinates.height` is the keyboard's own frame. On Android under
      // edge-to-edge this includes the suggestion strip / toolbar, which is
      // exactly what was clipping the last search result in the report.
      setInset(event.endCoordinates?.height ?? 0);
    });

    const hideSubscription = Keyboard.addListener(HIDE_EVENT, () => {
      setInset(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return inset;
}
