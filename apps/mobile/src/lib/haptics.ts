// Thin wrapper over expo-haptics, scoped to the app's actual use cases (per
// the project brief) rather than re-exposing expo-haptics' full API surface:
// a "completion" haptic for marking a task/goal done, a "light" tap haptic
// for generic feedback (e.g. opening quick-add), and the drag vocabulary the
// Notes tree reorder uses (start / slot tick / depth tick). Callers never
// touch expo-haptics directly, so a future change in which underlying
// feedback type maps to which semantic event happens in one place.

import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** Fire on a meaningful completion — task/goal marked done, reorder landed. */
export function hapticCompletion(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Fire on generic tap feedback — e.g. opening the quick-add sheet. */
export function hapticLight(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Fire once when a long-press drag lifts a row. Android has a dedicated
 *  drag-start effect in its haptic constants; iOS approximates with a
 *  medium impact. */
export function hapticDragStart(): void {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Drag_Start);
  } else {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

/** Fire when a drag crosses into a new vertical slot (row index change). */
export function hapticSlotTick(): void {
  void Haptics.selectionAsync();
}

/** Fire when a drag's projected depth (indent level) changes. */
export function hapticDepthTick(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
