// Thin wrapper around widget-bridge's native Android scheduler — the piece
// that keeps the home-screen widget's "TRACKING" band (elapsed time +
// progress bar) moving once a minute while this app's JS isn't alive to do
// it (backgrounded, or fully killed by the OS). See
// modules/widget-bridge/android/.../LiveTrackingScheduler.kt for the full
// design rationale and modules/widget-bridge/index.ts for the native call
// surface this wraps.
//
// Deliberately separate from src/widgets/widget-sync.ts's `syncWidgets()`:
// that redraws the FULL widget (today's schedule + tracking) through JS,
// on every start/pause/resume/stop transition and every RUNNING_SYNC_INTERVAL_MS
// while foregrounded. This only ever needs to be told "a session is running,
// starting from here" or "stop" — the native side re-derives elapsed time
// and progress itself, on its own schedule, with no further JS involvement.
// Both mechanisms run side by side rather than one replacing the other: the
// JS path still owns the rich, full-card redraw whenever it's actually
// alive to produce one.

import { Platform } from "react-native";

import { startAndroidLiveTracking as bridgeStart, stopAndroidLiveTracking as bridgeStop } from "widget-bridge";

export interface LiveTrackingInput {
  /** The task/goal/session name to show as the card's headline — `null`/blank both fall back to a placeholder (see `buildLiveTrackingPayload`), matching widget-data.ts's own "never show a blank title" rule. */
  primaryLabel: string | null | undefined;
  /** The parent goal's title, shown only when tracking a task that has one — same rule TodayWidget.tsx's TrackingBand applies to its own `secondaryLabel`. */
  secondaryLabel?: string | null;
  /** Epoch ms the current RUNNING segment began — timer-store.ts's `startedAt` (or the server session's equivalent via resolveEffectiveTimer). */
  startedAtMs: number;
  /** Elapsed ms accumulated before this running segment (i.e. across any earlier pauses) — timer-store.ts's `pausedElapsedMs`. */
  pausedElapsedMs: number;
}

const FALLBACK_LABEL = "Untitled session";

/**
 * Pure shape-and-validate step, split out from `startAndroidLiveTracking`
 * below purely so it's unit-testable without mocking the native module —
 * see android-live-tracking.test.ts.
 *
 * Guards the same way getElapsedMs (timer-store.ts) guards `pausedElapsedMs`:
 * a value crossing from a server session's `accumulatedMs` has no runtime
 * validation, and a non-finite one propagating into the native side's
 * `elapsedMs % PROGRESS_CYCLE_MS` arithmetic would draw a garbage progress
 * bar every tick until the next legitimate call overwrote it.
 */
export function buildLiveTrackingPayload(input: LiveTrackingInput): {
  taskName: string;
  secondaryLabel?: string;
  startedAtMs: number;
  pausedElapsedMs: number;
} {
  const trimmedPrimary = input.primaryLabel?.trim();
  const trimmedSecondary = input.secondaryLabel?.trim();
  return {
    taskName: trimmedPrimary ? trimmedPrimary : FALLBACK_LABEL,
    secondaryLabel: trimmedSecondary ? trimmedSecondary : undefined,
    startedAtMs: Number.isFinite(input.startedAtMs) ? input.startedAtMs : Date.now(),
    pausedElapsedMs: Number.isFinite(input.pausedElapsedMs) ? Math.max(0, input.pausedElapsedMs) : 0,
  };
}

/** Starts (or re-anchors) the native tick. No-ops on iOS/Expo Go — see widget-bridge/index.ts. */
export function startAndroidLiveTracking(input: LiveTrackingInput): void {
  if (Platform.OS !== "android") return;
  bridgeStart(buildLiveTrackingPayload(input));
}

/** Stops the native tick. No-ops on iOS/Expo Go — see widget-bridge/index.ts. */
export function stopAndroidLiveTracking(): void {
  if (Platform.OS !== "android") return;
  bridgeStop();
}
