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

/** Fire when something went wrong but nothing was lost — a retryable failure. */
export function hapticWarning(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

/**
 * Fire the moment the microphone opens. Deliberately the heaviest impact in
 * this file: it is the only confirmation a user gets that the app started
 * listening, and on a voice interface that beat has to be unmistakable —
 * they are about to talk to something they cannot see respond.
 */
export function hapticListenStart(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

/** Fire when the microphone closes and the app starts thinking. */
export function hapticListenEnd(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * Fire once, mid-session, the moment a hold-to-record gesture is dragged far
 * enough to lock into hands-free recording (see HoldToRecordMic). Distinct
 * from `hapticListenStart` (the mic opening) and `hapticCompletion` (a
 * command finished) — this is a third, mid-flight event with nothing to
 * confirm on screen the instant it happens beyond a badge appearing, so the
 * haptic is what tells a user who slid up fast that the lock actually took.
 */
export function hapticRecordingLocked(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}
