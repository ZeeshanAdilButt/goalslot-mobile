// Rotating affirmations strip — mobile port of goal-slot-web's
// journal-affirmations.tsx. Same 6 phrases (journal-writing-help.ts's
// `JOURNAL_AFFIRMATIONS`), same ~8s dwell before advancing, same short
// cross-fade between them (web: 700ms cross-fade via CSS opacity
// transition). Sits under the "Journal" eyebrow, same "doesn't fight the
// header for vertical space" placement web's own comment describes.
//
// Reanimated cross-fade, following this screen's own idiom for a timed
// opacity transition (journal.tsx's `editorTransitionStyle`: a shared value
// driven by `withTiming`, jumped straight to its resting value instead of
// animated when Reduce Motion is on — see MicOrb.tsx for the same
// "still change, just don't animate the change" rule applied to a pulse
// instead of a cross-fade).

import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, typography } from "@/theme/tokens";

import { JOURNAL_AFFIRMATIONS } from "./journal-writing-help";

/** How long one affirmation stays fully visible before the next one fades in. Matches web's 8s interval. */
const AFFIRMATION_INTERVAL_MS = 8000;
/** Fade duration in each direction. Matches web's 700ms CSS transition — longer and calmer than this app's usual 150–200ms UI transitions (see theme/foundation.ts's `motion.duration`), which is the point: this is ambient, not a response to a tap. */
const AFFIRMATION_FADE_MS = 700;

export function JournalAffirmations() {
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const opacity = useSharedValue(1);
  // Tracks the mid-fade "swap the text now" timeout so it can be cancelled
  // on unmount — without this, a fade already in flight when the screen
  // unmounts (e.g. navigating away mid-cross-fade) would still fire its
  // `setIndex` afterward, a state update on an unmounted component.
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (reduceMotion) {
        // Content still rotates under Reduce Motion — an affirmation is
        // information, not decoration, so it keeps changing. Only the fade
        // itself (the part that's purely decorative motion) is skipped.
        setIndex((i) => (i + 1) % JOURNAL_AFFIRMATIONS.length);
        return;
      }
      // Fade out, then — timed on the JS side rather than off the
      // animation's own completion callback (which fires on the UI thread
      // and would need `runOnJS` to reach the `setIndex` state setter below)
      // — swap the text and fade back in.
      opacity.value = withTiming(0, { duration: AFFIRMATION_FADE_MS, easing: Easing.inOut(Easing.quad) });
      fadeTimeoutRef.current = setTimeout(() => {
        setIndex((i) => (i + 1) % JOURNAL_AFFIRMATIONS.length);
        opacity.value = withTiming(1, { duration: AFFIRMATION_FADE_MS, easing: Easing.inOut(Easing.quad) });
      }, AFFIRMATION_FADE_MS);
    }, AFFIRMATION_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [opacity, reduceMotion]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : opacity.value,
  }));

  return (
    <Animated.Text style={[styles.text, fadeStyle]} accessibilityLiveRegion="polite">
      {JOURNAL_AFFIRMATIONS[index]}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontStyle: "italic",
  },
});
