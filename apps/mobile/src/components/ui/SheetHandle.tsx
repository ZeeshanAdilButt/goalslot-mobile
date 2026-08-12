// The grab handle at the top of a bottom sheet, in a version people can
// actually use.
//
// @gorhom/bottom-sheet's default handle is a 4px indicator inside 10px of
// padding — a 24pt drag target, well under the 44pt minimum — and the only
// thing it tells a screen reader is "drag up or down to extend or minimize
// the bottom sheet", which is an instruction a screen-reader user cannot
// follow. This replacement is 44pt tall and carries real accessibility
// actions, so resizing never depends on landing a pan gesture:
//
//   - role "adjustable" + increment/decrement, which TalkBack and VoiceOver
//     surface as swipe-up / swipe-down on the focused element,
//   - a plain tap that toggles between the smallest and largest detent, for
//     anyone who taps the handle instead of dragging it (a common reflex),
//   - an accessibilityValue that announces which state the sheet is in.
//
// The pan gesture is untouched: the library wraps whatever `handleComponent`
// returns in its own GestureDetector, and a stationary tap never activates a
// pan, so the two coexist.
//
// This only makes sense on a sheet with MORE THAN ONE detent. A sheet
// configured with `enableDynamicSizing` and no `snapPoints` has exactly one
// (the measured content height — see useAnimatedDetents in the library), so
// dragging up is clamped to where it already is and the handle reads as
// broken. That was the bug this component was written for; the fix is a
// second snap point on the sheet, and this handle is what makes it reachable
// without a gesture.

import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View, type AccessibilityActionEvent } from "react-native";
import { useBottomSheet } from "@gorhom/bottom-sheet";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";

import { colors, minTouchTarget, radii, spacing } from "@/theme/tokens";

const ACCESSIBILITY_ACTIONS = [
  { name: "increment", label: "Expand sheet" },
  { name: "decrement", label: "Collapse sheet" },
];

export function SheetHandle() {
  const { collapse, expand, animatedIndex } = useBottomSheet();

  // `collapse()` goes to detent 0 and `expand()` to the last one, so "not at
  // 0" is the same thing as "expanded" for every sheet using this handle.
  // Mirrored onto React state (rather than read off the shared value at
  // press time) because the label and the announced value have to re-render
  // when the user changes the size by dragging, not just by tapping.
  const [isExpanded, setIsExpanded] = useState(false);
  useAnimatedReaction(
    () => animatedIndex.get() > 0,
    (expanded, previous) => {
      if (expanded !== previous) {
        runOnJS(setIsExpanded)(expanded);
      }
    },
    [animatedIndex],
  );

  const toggle = useCallback(() => {
    if (isExpanded) {
      collapse();
    } else {
      expand();
    }
  }, [collapse, expand, isExpanded]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "increment") {
        expand();
      } else if (event.nativeEvent.actionName === "decrement") {
        collapse();
      }
    },
    [collapse, expand],
  );

  return (
    <Pressable
      onPress={toggle}
      style={styles.container}
      accessibilityRole="adjustable"
      accessibilityLabel="Sheet size"
      accessibilityHint="Swipe up to expand, swipe down to collapse"
      accessibilityValue={{ text: isExpanded ? "Expanded" : "Collapsed" }}
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      onAccessibilityAction={handleAccessibilityAction}
    >
      <View style={styles.indicator} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // 44pt of touch target around a 4pt indicator. The indicator stays the
    // same size the sheets already drew — this grows the target, not the
    // visual weight.
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingVertical: spacing.xl,
  },
  indicator: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.border,
  },
});
