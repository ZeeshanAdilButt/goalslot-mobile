// Thin wrapper over expo-haptics, scoped to the two v1 use cases (per the
// project brief) rather than re-exposing expo-haptics' full API surface:
// a "completion" haptic for marking a task/goal done, and a "light" tap
// haptic for generic feedback (e.g. opening quick-add). Callers never touch
// expo-haptics directly, so a future change in which underlying feedback
// type maps to "completion" vs "light" happens in one place.

import * as Haptics from "expo-haptics";

/** Fire on a meaningful completion — task/goal marked done. */
export function hapticCompletion(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Fire on generic tap feedback — e.g. opening the quick-add sheet. */
export function hapticLight(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
