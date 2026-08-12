// Keeps a chat thread pinned to the newest message across the four events
// that fight over scroll position: new content, keyboard show, keyboard
// hide, and paging older history in above.
//
// Why not an inverted list, the usual React Native answer: `inverted` is
// implemented as a scaleY(-1) transform on the list and every cell, which
// reverses the traversal order for TalkBack and VoiceOver. A thread then
// reads newest-to-oldest, which is backwards, and the accessibility bar for
// this feature is high. A normal list plus explicit pinning costs this file
// and gets reading order right.
//
// The rule everywhere below is PIN ONLY IF ALREADY AT THE BOTTOM. Yanking a
// user who has scrolled up to read history down to the newest message —
// because someone else typed, or because the keyboard opened — is the single
// most annoying thing a chat screen can do. `isPinnedRef` is a ref rather
// than state because it's read inside scroll/keyboard callbacks and must
// never trigger a re-render of a list of bubbles.

import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

/**
 * How close to the bottom still counts as "at the bottom". A couple of lines
 * of slack: a user who is a few pixels off the end because of bounce, or who
 * nudged the list, still wants to follow the conversation.
 */
const PIN_THRESHOLD_PX = 80;

/**
 * The keyboard events to listen for. iOS's `keyboardWillShow` fires with the
 * animation, so the scroll travels with the keyboard instead of snapping
 * after it lands. Android only has `keyboardDidShow`.
 */
const SHOW_EVENT = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE_EVENT = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

export interface UseThreadScrollResult {
  listRef: React.RefObject<FlatList<unknown> | null>;
  /** Wire to the list's `onScroll`. */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Wire to the list's `onContentSizeChange`. */
  onContentSizeChange: () => void;
  /** Jump to the newest message regardless of current position (e.g. the "new messages" pill). */
  scrollToBottom: (animated?: boolean) => void;
  /** True while the user is following the live end of the thread. */
  isPinned: boolean;
  /** True while the software keyboard is up — the composer uses it for its bottom inset. */
  keyboardVisible: boolean;
}

export function useThreadScroll(options: { reduceMotion?: boolean } = {}): UseThreadScrollResult {
  const { reduceMotion = false } = options;

  const listRef = useRef<FlatList<unknown> | null>(null);
  const isPinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const scrollToBottom = useCallback(
    (animated = true) => {
      listRef.current?.scrollToEnd({ animated: animated && !reduceMotion });
    },
    [reduceMotion],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const pinned = distanceFromBottom <= PIN_THRESHOLD_PX;

    isPinnedRef.current = pinned;
    // Only push to state on a real transition: `onScroll` fires continuously
    // while dragging, and setting state on every frame would re-render the
    // whole thread mid-gesture.
    setIsPinned((current) => (current === pinned ? current : pinned));
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (isPinnedRef.current) {
      scrollToBottom(true);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(SHOW_EVENT, () => {
      setKeyboardVisible(true);
      if (isPinnedRef.current) {
        // The list shrinks as the keyboard takes its space; without this the
        // newest message ends up hidden behind the composer.
        scrollToBottom(true);
      }
    });

    const hideSubscription = Keyboard.addListener(HIDE_EVENT, () => {
      setKeyboardVisible(false);
      if (isPinnedRef.current) {
        // Dismissing the keyboard grows the list again. Leaving the offset
        // alone strands the view above the newest message with an empty gap
        // where the keyboard was — the classic "my last message disappeared
        // when I closed the keyboard" bug.
        scrollToBottom(false);
      }
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollToBottom]);

  return { listRef, onScroll, onContentSizeChange, scrollToBottom, isPinned, keyboardVisible };
}
