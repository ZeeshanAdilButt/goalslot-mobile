// Shared "check for, download, and apply an OTA update" sequence.
//
// Extracted from app/(app)/settings.tsx's "Live update" row so the exact
// same check-fetch-reload sequence can also be triggered from a notification
// tap (app/_layout.tsx's "release" case — see src/lib/deep-links.ts's
// `resolveNotificationAction`) without a second, drifting copy of the
// expo-updates call sequence. Error handling and toast copy stay with each
// caller (they differ: a manual settings tap vs. a background notification
// tap warrant different messaging), so this only owns the sequence itself
// and does not catch — a rejected promise here is the caller's to handle.

import * as Updates from "expo-updates";

export type UpdateCheckStatus = "unavailable" | "up-to-date" | "updated";

/**
 * Checks for an OTA update and, if one exists, downloads and applies it.
 * `Updates.reloadAsync()` restarts the app onto the new bundle, so in
 * practice this promise never actually resolves with "updated" — the app is
 * gone before it can. The return type stays honest about that outcome
 * existing rather than pretending only two states are reachable.
 *
 * `onUpdateAvailable` fires right before the download starts, purely so a
 * caller can show a "downloading…" toast at the right moment — it takes no
 * part in the control flow.
 */
export async function checkForUpdateAndReload(onUpdateAvailable?: () => void): Promise<UpdateCheckStatus> {
  if (!Updates.isEnabled) {
    return "unavailable";
  }
  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) {
    return "up-to-date";
  }
  onUpdateAvailable?.();
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return "updated";
}
