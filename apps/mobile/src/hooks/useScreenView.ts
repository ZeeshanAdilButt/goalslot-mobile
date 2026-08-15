// Fires the `screenViewed` analytics event once per focus, the same
// `useFocusEffect(useCallback(() => analytics.track(...), [analytics]))`
// five-liner every tab/screen in app/(app) was independently retyping —
// harmless on its own, but 17 independent copies is 17 chances for the
// screenName string to be pasted from the wrong screen or the dependency
// array to drift. A screen with its own other focus-time work (e.g.
// goals.tsx's `setTodayKey`, timer.tsx's session-query invalidation) still
// registers this alongside its own separate `useFocusEffect` — one extra
// hook call, not a reason to fold unrelated logic in here.

import { useCallback } from "react";
import { useFocusEffect } from "expo-router";

import { useAnalytics } from "@/providers/growth-provider";

export function useScreenView(screenName: string): void {
  const analytics = useAnalytics();
  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName } });
    }, [analytics, screenName]),
  );
}
