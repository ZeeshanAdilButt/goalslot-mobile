// iOS counterpart to widget-task-handler.tsx. Android redraws its widget
// from a headless JS task the OS itself schedules; iOS has no equivalent —
// a WidgetKit extension can't run this app's JS at all. So instead the
// foregrounded app computes the same `WidgetViewState` (via the platform-
// neutral `loadWidgetViewState` this already shares with Android) and pushes
// it into the shared App Group container through `widget-bridge`, every
// time the app comes to the foreground. The extension's own TimelineProvider
// reads whatever was last written there — see targets/widget/GoalSlotWidget.swift.
//
// This means the widget is only as fresh as the last time GoalSlot was
// opened, not truly live like Android's timer-driven redraw. Closing that
// gap needs a BGAppRefreshTask, which is its own separate scope — flagged
// here rather than silently pretended away.

import { setIOSWidgetState, reloadIOSWidgets } from "widget-bridge";

import { loadWidgetTrackingState, loadWidgetViewState, type WidgetTrackingState, type WidgetViewState } from "./widget-data";

/** Flat JSON shape the Swift side decodes — see WidgetState in GoalSlotWidget.swift. Deliberately flat (no nested discriminated union, and `tracking` bolted onto every schedule `kind` rather than modeled separately) because Swift's Codable has no built-in support for either. */
function toWidgetStateJSON(state: WidgetViewState, tracking: WidgetTrackingState | null): string {
  const trackingFields = tracking
    ? {
        trackingStatus: tracking.status,
        trackingPrimaryLabel: tracking.primaryLabel,
        trackingSecondaryLabel: tracking.secondaryLabel ?? null,
        trackingElapsedLabel: tracking.elapsedLabel,
        trackingProgress: tracking.progress,
      }
    : {
        trackingStatus: null,
        trackingPrimaryLabel: null,
        trackingSecondaryLabel: null,
        trackingElapsedLabel: null,
        trackingProgress: null,
      };

  switch (state.kind) {
    case "block":
      return JSON.stringify({
        kind: "block",
        status: state.status,
        title: state.block.title,
        timeRange: state.block.timeRange,
        color: state.block.color,
        goalId: state.block.goalId ?? null,
        // Bonus content for `.systemLarge` only — see GoalSlotWidget.swift's
        // `family` check — mirroring TodayWidget.tsx's `dayProgress`/
        // `hasRoomForExtras` on Android (Swift decides the size gate itself
        // since it has `@Environment(\.widgetFamily)`; there's no
        // Android-style height threshold to compute here).
        dayDone: state.dayProgress.done,
        dayTotal: state.dayProgress.total,
        ...trackingFields,
      });
    case "progress":
      return JSON.stringify({ kind: "progress", done: state.done, total: state.total, ...trackingFields });
    case "empty-day":
      return JSON.stringify({ kind: "empty-day", ...trackingFields });
    case "unavailable":
      return JSON.stringify({ kind: "unavailable", ...trackingFields });
  }
}

/** Computes today's widget state — schedule and tracking status alike (see widget-data.ts's tracking-state header comment for why they're independent reads) — and pushes it to the iOS home-screen widget. No-ops on Android (widget-bridge's native module is iOS-only). */
export async function syncIOSWidget(): Promise<void> {
  const [state, tracking] = await Promise.all([loadWidgetViewState(), loadWidgetTrackingState()]);
  setIOSWidgetState(toWidgetStateJSON(state, tracking));
  reloadIOSWidgets();
}
