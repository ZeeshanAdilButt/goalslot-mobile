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
// A thread also has to LAND somewhere when it opens, and that turned out to
// be where the bugs were. Three separate mechanisms conspired to drop the
// user part-way up the history with a "Jump to latest" pill on a thread they
// had fully read:
//
//   1. The landing scroll was `scrollToEnd({ animated: true })`. An animated
//      scroll emits intermediate scroll events starting from y≈0, and the
//      screen pages older history in whenever the offset is near the top — so
//      simply opening a thread fetched a page of older messages, which
//      `maintainVisibleContentPosition` then held the view against, parking
//      it mid-history. `hasSettled` below exists to stop that: the landing
//      scroll is now instant, and the screen ignores scroll events until it
//      has finished.
//   2. The animation's target was computed against the content size at call
//      time, but FlatList windows more cells in while it runs, so it landed
//      short — and once the pin flipped false it was never re-armed, because
//      `onContentSizeChange` is gated on the pin it just cleared. The settle
//      loop re-issues the landing scroll on every content-size change until
//      the size stops moving.
//   3. Nothing reset per conversation. This screen is a hidden tab and never
//      unmounts, so pin state (and the native scroll offset itself) carried
//      from one conversation into the next. `resetKey` re-arms both.
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

/**
 * How long the content size has to hold still before the landing scroll is
 * considered done. `onContentSizeChange` only fires when the size CHANGES, so
 * "two equal measurements in a row" never arrives on its own — a quiet period
 * is what actually signals that the list has finished windowing cells in.
 */
const SETTLE_QUIET_MS = 250;

export interface UseThreadScrollResult {
  listRef: React.RefObject<FlatList<unknown> | null>;
  /** Wire to the list's `onScroll`. */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Wire to the list's `onContentSizeChange`. */
  onContentSizeChange: () => void;
  /** Wire to the list's `onScrollBeginDrag` — a real finger ends the landing phase immediately. */
  onScrollBeginDrag: () => void;
  /**
   * False until the opening scroll has landed and the content size has stopped
   * moving. Callers must not page older history or show a "jump to latest"
   * affordance while this is false: nothing on screen is where it will end up,
   * so any conclusion drawn from the offset is about a transient state.
   */
  hasSettled: boolean;
  /** Jump to the newest message regardless of current position (e.g. the "new messages" pill). */
  scrollToBottom: (animated?: boolean) => void;
  /** True while the user is following the live end of the thread. */
  isPinned: boolean;
  /** True while the software keyboard is up — the composer uses it for its bottom inset. */
  keyboardVisible: boolean;
}

export function useThreadScroll(
  options: {
    reduceMotion?: boolean;
    /**
     * Changing this re-arms the landing phase — pass the conversation id.
     * Without it, pin state and the native scroll offset survive from the
     * previous conversation, because this screen never unmounts.
     */
    resetKey?: string;
    /**
     * Row index to land on when the thread opens, or null/undefined to land
     * on the newest message. Used to park at the first unread message; see
     * lib/thread-anchor.ts for how it is chosen.
     */
    initialIndex?: number | null;
  } = {},
): UseThreadScrollResult {
  const { reduceMotion = false, resetKey, initialIndex = null } = options;

  const listRef = useRef<FlatList<unknown> | null>(null);
  const isPinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const hasSettledRef = useRef(false);
  const [hasSettled, setHasSettled] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside callbacks that must not be re-created when the target moves.
  const initialIndexRef = useRef(initialIndex);
  initialIndexRef.current = initialIndex;

  const scrollToBottom = useCallback(
    (animated = true) => {
      listRef.current?.scrollToEnd({ animated: animated && !reduceMotion });
    },
    [reduceMotion],
  );

  const markSettled = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (hasSettledRef.current) return;
    hasSettledRef.current = true;
    setHasSettled(true);
  }, []);

  /**
   * Put the view where this visit should start. Always UNANIMATED: an
   * animated landing is what emitted the near-zero offsets that tripped the
   * screen's "load older history" threshold, and its target went stale as the
   * list windowed more cells in.
   */
  const scrollToLanding = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const target = initialIndexRef.current;
    if (target === null || target === undefined) {
      list.scrollToEnd({ animated: false });
      return;
    }

    try {
      // viewPosition 0 puts the first unread message at the TOP of the
      // viewport, so the unread run reads downward from there.
      list.scrollToIndex({ index: target, animated: false, viewPosition: 0 });
    } catch {
      // scrollToIndex throws if the row has not been measured yet. The settle
      // loop will call this again on the next content-size change; landing at
      // the end is a sane place to be until then.
      list.scrollToEnd({ animated: false });
    }
  }, []);

  // Re-arm everything when the conversation changes. This screen is a hidden
  // tab, so none of this state is reset by a remount — without it, scrolling
  // up in one thread leaves the next thread unpinned and never landed.
  useEffect(() => {
    isPinnedRef.current = true;
    setIsPinned(true);
    hasSettledRef.current = false;
    setHasSettled(false);
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, [resetKey]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Ignore everything until the landing scroll has settled. These events are
    // the programmatic scroll's own intermediate frames, not the user leaving
    // the bottom, and treating them as user intent is what cleared the pin and
    // left the "Jump to latest" pill showing on a fully-read thread.
    if (!hasSettledRef.current) return;

    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const pinned = distanceFromBottom <= PIN_THRESHOLD_PX;

    isPinnedRef.current = pinned;
    // Only push to state on a real transition: `onScroll` fires continuously
    // while dragging, and setting state on every frame would re-render the
    // whole thread mid-gesture.
    setIsPinned((current) => (current === pinned ? current : pinned));
  }, []);

  // A real finger always wins. If the user starts dragging during the landing
  // phase, stop steering immediately rather than fighting them for the offset.
  const onScrollBeginDrag = useCallback(() => {
    markSettled();
  }, [markSettled]);

  const onContentSizeChange = useCallback(() => {
    if (!hasSettledRef.current) {
      // Landing phase: re-issue the scroll on every size change, and treat a
      // quiet period as "the list has stopped growing". A single scroll here
      // is not enough — FlatList renders ~10 rows first and windows the rest
      // in afterwards, so the first target is always short of the real end.
      scrollToLanding();
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        // One last correction against the final content size before handing
        // control back to the pin logic.
        scrollToLanding();
        markSettled();
      }, SETTLE_QUIET_MS);
      return;
    }

    if (isPinnedRef.current) {
      scrollToBottom(true);
    }
  }, [markSettled, scrollToBottom, scrollToLanding]);

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

  return {
    listRef,
    onScroll,
    onContentSizeChange,
    onScrollBeginDrag,
    hasSettled,
    scrollToBottom,
    isPinned,
    keyboardVisible,
  };
}
