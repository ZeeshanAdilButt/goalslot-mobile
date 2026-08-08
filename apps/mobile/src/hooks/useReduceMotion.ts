// Backs the auth screens' entrance animations. `AccessibilityInfo` has no
// synchronous accessor, so the very first render always assumes motion is
// fine and flips to `true` a tick later if the OS setting says otherwise —
// on a reduce-motion device this means the entrance animation's first
// frame or two can still play before the flag lands. That's an accepted
// trade-off (the alternative is delaying the screen's first paint until the
// async check resolves, which is worse for everyone) rather than a gap in
// support: once the flag is known, every subsequent animation on the screen
// respects it.

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
