// The home-screen widget's actual visual tree.
//
// WHY `FlexWidget`/`TextWidget` instead of `View`/`Text`: a home-screen
// widget is drawn by Android as native `RemoteViews` inside the launcher's
// own process, not as a mounted React Native view hierarchy inside this
// app's process — there is no RN renderer running there to interpret a
// `View`/`Text`/`StyleSheet` tree at all. `react-native-android-widget`'s
// primitives exist specifically to compile down to `RemoteViews` (see
// `AndroidWidget.drawWidgetById` in the library, called from
// `widget-task-handler.tsx`), which is the only thing the launcher process
// knows how to render. Regular RN components silently do nothing here.
//
// Colors are pulled from `@/theme` per the app's own token set rather than
// re-declared, but only the individual fields each widget primitive's
// `style` actually supports are copied across (fontSize/fontWeight/color/
// letterSpacing/lineHeight for text) — the full semantic text-style objects
// in `@/theme` (`typography` role presets) also carry RN-only fields like
// `textTransform`, which `TextWidgetStyle` has no equivalent for, so they
// can't be spread wholesale the way a real screen would.

import { FlexWidget, TextWidget, type FlexWidgetStyle, type TextWidgetStyle } from "react-native-android-widget";

import { scheduleDayDeepLink, timerAutoStartDeepLink, timerDeepLink, type ScheduleDayOfWeek } from "@/lib/deep-links";
import { colors, radii, spacing, typography } from "@/theme";

import type { WidgetTrackingState, WidgetViewState } from "./widget-data";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Validates a block/category color before handing it to a widget primitive — `ColorProp` is typed as a literal `#RRGGBB` template, but the value coming off the API is just `string`. Falls back to a safe theme color for anything malformed rather than letting the native draw call fail. */
function toHexColor(color: string, fallback: `#${string}`): `#${string}` {
  return HEX_COLOR_RE.test(color) ? (color as `#${string}`) : fallback;
}

/** `Date#getDay()` is typed as plain `number`; it is always 0-6 at runtime, which is exactly what `ScheduleDayOfWeek` narrows to. */
function todayDeepLink(): string {
  return scheduleDayDeepLink(new Date().getDay() as ScheduleDayOfWeek);
}

/**
 * Below this, a resized widget has room for at most the compact content —
 * anything more would either clip or force scaling react-native-android-
 * widget doesn't support. Above it, there's meaningfully more height than
 * the compact layout needs, which is exactly the "big blank card" bug this
 * threshold exists to avoid: rather than leave that space empty, `Body`
 * shows today's overall progress as bonus content underneath the block.
 * Chosen empirically against the compact layout's natural height (header +
 * block + a little breathing room ≈ 150dp) with margin for the tracking
 * band, which adds its own ~70dp when present.
 */
const EXTRAS_HEIGHT_THRESHOLD_DP = 200;

export interface TodayWidgetProps {
  state: WidgetViewState;
  /** What's actually being tracked right now, independent of `state` — see widget-data.ts's `loadWidgetTrackingState`. `null` while idle. */
  tracking: WidgetTrackingState | null;
  /** Current widget height in dp, from `widgetTaskHandler`'s `widgetInfo.height` — react-native-android-widget gives no "size class" the way iOS's `.widgetFamily` does, so this is the only signal available for "is there room to show more than the compact layout." */
  heightDp: number;
}

export function TodayWidget({ state, tracking, heightDp }: TodayWidgetProps) {
  // Tapping the widget while a session is running goes to the Timer tab
  // (there's something live to look at); otherwise it goes to today's
  // schedule, same as before tracking existed.
  const rootDeepLink = tracking ? timerDeepLink() : todayDeepLink();
  const hasRoomForExtras = heightDp >= EXTRAS_HEIGHT_THRESHOLD_DP;
  return (
    <FlexWidget
      style={rootStyle}
      clickAction="OPEN_URI"
      clickActionData={{ uri: rootDeepLink }}
      accessibilityLabel={tracking ? "Open GoalSlot timer" : "Open GoalSlot schedule"}
    >
      <Header />
      <FlexWidget style={bodyStyle}>
        <Body state={state} tracking={tracking} hasRoomForExtras={hasRoomForExtras} />
      </FlexWidget>
      {tracking && <TrackingBand tracking={tracking} />}
    </FlexWidget>
  );
}

function Header() {
  return (
    <FlexWidget style={headerStyle}>
      <FlexWidget style={brandDotStyle} />
      <TextWidget text="TODAY" style={eyebrowStyle} />
    </FlexWidget>
  );
}

function Body({
  state,
  tracking,
  hasRoomForExtras,
}: {
  state: WidgetViewState;
  tracking: WidgetTrackingState | null;
  hasRoomForExtras: boolean;
}) {
  switch (state.kind) {
    case "block":
      // A "Track" shortcut only makes sense when nothing is already
      // running (tapping it again mid-session would restart the timer —
      // see timer.tsx's `autostart` guard) and the block actually has a
      // goal to attach the session to.
      return (
        <BlockBody
          status={state.status}
          block={state.block}
          showTrackButton={!tracking && !!state.block.goalId}
          dayProgress={hasRoomForExtras ? state.dayProgress : null}
        />
      );
    case "progress":
      return <ProgressBody done={state.done} total={state.total} />;
    case "empty-day":
      return (
        <MessageBody
          headline="Nothing scheduled"
          detail="Your day is wide open."
        />
      );
    case "unavailable":
      return <MessageBody headline="Open GoalSlot" detail="Tap to view your day." />;
  }
}

function BlockBody({
  status,
  block,
  showTrackButton,
  dayProgress,
}: {
  status: "active" | "upcoming";
  block: { title: string; timeRange: string; color: string; goalId?: string };
  showTrackButton: boolean;
  /** Non-null only when the caller has already decided there's room to show it — see `TodayWidget`'s `hasRoomForExtras`. */
  dayProgress: { done: number; total: number } | null;
}) {
  const isActive = status === "active";
  return (
    <FlexWidget style={blockColumnStyle}>
      <FlexWidget style={blockRowStyle}>
        <FlexWidget style={blockColumnStyle}>
          <FlexWidget style={blockTopRowStyle}>
            <FlexWidget style={{ ...accentDotStyle, backgroundColor: toHexColor(block.color, colors.primary) }} />
            <FlexWidget style={statusChipStyle(isActive)}>
              <TextWidget text={isActive ? "NOW" : "NEXT"} style={statusChipTextStyle(isActive)} />
            </FlexWidget>
          </FlexWidget>
          <TextWidget text={block.title} style={blockTitleStyle} truncate="END" maxLines={1} />
          <TextWidget text={block.timeRange} style={blockTimeStyle} />
        </FlexWidget>
        {showTrackButton && block.goalId && <TrackButton goalId={block.goalId} />}
      </FlexWidget>
      {/* Fills the extra room a large resize leaves below the block instead
          of it sitting blank — see `EXTRAS_HEIGHT_THRESHOLD_DP`. */}
      {dayProgress && <DayProgressRow done={dayProgress.done} total={dayProgress.total} />}
    </FlexWidget>
  );
}

function DayProgressRow({ done, total }: { done: number; total: number }) {
  const allDone = done >= total && total > 0;
  return (
    <FlexWidget style={dayProgressRowStyle}>
      <TextWidget text="TODAY'S PROGRESS" style={dayProgressLabelStyle} />
      <TextWidget
        text={allDone ? `All ${total} blocks done — nice work` : `${done} of ${total} blocks done so far`}
        style={dayProgressValueStyle}
      />
    </FlexWidget>
  );
}

/** Its own `clickAction`, separate from the root widget's — tapping it starts tracking directly instead of just opening the app. Mirrors the iOS widget's medium-size "Start" button (targets/widget/GoalSlotWidget.swift). */
function TrackButton({ goalId }: { goalId: string }) {
  return (
    <FlexWidget
      style={trackButtonStyle}
      clickAction="OPEN_URI"
      clickActionData={{ uri: timerAutoStartDeepLink(goalId) }}
      accessibilityLabel="Start tracking this goal"
    >
      <TextWidget text="Track" style={trackButtonTextStyle} />
    </FlexWidget>
  );
}

/** A persistent status band for "what's being tracked right now" — shown regardless of what today's schedule body above is displaying, since the two can disagree (e.g. tracking a goal that isn't even one of today's scheduled blocks). Task wins over its parent goal as the headline label (`primaryLabel`), with the goal as a subtitle when there is one — see widget-data.ts's `loadWidgetTrackingState`. */
function TrackingBand({ tracking }: { tracking: WidgetTrackingState }) {
  const isPaused = tracking.status === "paused";
  return (
    <FlexWidget style={trackingBandStyle}>
      <FlexWidget style={trackingHeaderRowStyle}>
        <FlexWidget style={trackingStatusGroupStyle}>
          <FlexWidget style={{ ...trackingDotStyle, backgroundColor: isPaused ? colors.mutedForeground : colors.primary }} />
          <TextWidget text={isPaused ? "Paused" : "Tracking"} style={trackingLabelStyle} />
        </FlexWidget>
        <TextWidget text={tracking.elapsedLabel} style={trackingElapsedStyle} />
      </FlexWidget>
      <TextWidget text={tracking.primaryLabel} style={trackingTitleStyle} truncate="END" maxLines={1} />
      {tracking.secondaryLabel && (
        <TextWidget text={tracking.secondaryLabel} style={trackingSubtitleStyle} truncate="END" maxLines={1} />
      )}
      <ProgressBar progress={tracking.progress} isPaused={isPaused} />
    </FlexWidget>
  );
}

/**
 * A flexbox-ratio trick, not a native progress primitive (the library
 * doesn't have one): a fixed-height row split into a filled leading
 * segment and an empty trailing one, sized via `flex` the same way
 * `flex-grow` would size two siblings — see widget-data.ts's
 * `WidgetTrackingState.progress` for why this isn't live-ticking.
 */
function ProgressBar({ progress, isPaused }: { progress: number; isPaused: boolean }) {
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <FlexWidget style={progressTrackStyle}>
      <FlexWidget style={{ flex: filled, backgroundColor: isPaused ? colors.mutedForeground : colors.primary }} />
      <FlexWidget style={{ flex: 1 - filled }} />
    </FlexWidget>
  );
}

function ProgressBody({ done, total }: { done: number; total: number }) {
  const allDone = done >= total && total > 0;
  return (
    <FlexWidget style={blockColumnStyle}>
      <TextWidget text={`${done} of ${total}`} style={statValueStyle} />
      <TextWidget text={allDone ? "blocks done — nice work" : "blocks done today"} style={blockTimeStyle} />
    </FlexWidget>
  );
}

function MessageBody({ headline, detail }: { headline: string; detail: string }) {
  return (
    <FlexWidget style={blockColumnStyle}>
      <TextWidget text={headline} style={blockTitleStyle} maxLines={1} />
      <TextWidget text={detail} style={blockTimeStyle} />
    </FlexWidget>
  );
}

// ---------------------------------------------------------------------------
// Styles — hand-picked fields per primitive, see header comment for why this
// isn't a `StyleSheet.create` spread of `@/theme`'s semantic text roles.
// ---------------------------------------------------------------------------

const rootStyle: FlexWidgetStyle = {
  width: "match_parent",
  height: "match_parent",
  flexDirection: "column",
  backgroundColor: colors.card,
  borderRadius: radii.card,
  borderWidth: 1,
  borderColor: colors.border,
  padding: spacing.md,
};

const headerStyle: FlexWidgetStyle = {
  flexDirection: "row",
  alignItems: "center",
  flexGap: spacing.xs,
};

// Brand yellow used as a small accent mark only — same restraint the rest of
// the app applies to `colors.primary` (a chip badge on the Schedule screen's
// "Now" state, not a dominant fill).
const brandDotStyle: FlexWidgetStyle = {
  width: 6,
  height: 6,
  borderRadius: radii.full,
  backgroundColor: colors.primary,
};

const eyebrowStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "600",
  letterSpacing: 0.5,
  color: colors.mutedForeground,
};

// `justifyContent: "flex-start"`, not "center" — the widget is now freely
// resizable (app.json's `resizeMode`/`maxResizeWidth`/`maxResizeHeight`), and
// centering left a large dead gap ABOVE the content on a tall resize (the
// content floats mid-card, disconnected from the "TODAY" header above it).
// Anchoring to the top keeps content flush under the header regardless of
// how much extra height the user drags in; any leftover space collects
// below instead, which reads as breathing room rather than a layout bug.
const bodyStyle: FlexWidgetStyle = {
  flex: 1,
  flexDirection: "column",
  justifyContent: "flex-start",
};

const blockRowStyle: FlexWidgetStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
};

const dayProgressRowStyle: FlexWidgetStyle = {
  flexDirection: "column",
  flexGap: spacing.xxs,
  marginTop: spacing.md,
  paddingTop: spacing.sm,
  borderTopWidth: 1,
  borderTopColor: colors.border,
};

const dayProgressLabelStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "600",
  letterSpacing: 0.5,
  color: colors.mutedForeground,
};

const dayProgressValueStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  fontWeight: "600",
  color: colors.foreground,
};

const blockColumnStyle: FlexWidgetStyle = {
  flexDirection: "column",
  flexGap: spacing.xxs,
};

const trackButtonStyle: FlexWidgetStyle = {
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: radii.full,
  backgroundColor: colors.primary,
};

const trackButtonTextStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  fontWeight: "600",
  color: colors.primaryForeground,
};

const trackingBandStyle: FlexWidgetStyle = {
  flexDirection: "column",
  flexGap: spacing.xxs,
  marginTop: spacing.xs,
  paddingTop: spacing.xs,
  borderTopWidth: 1,
  borderTopColor: colors.border,
};

const trackingHeaderRowStyle: FlexWidgetStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  flexGap: spacing.xxs,
};

const trackingStatusGroupStyle: FlexWidgetStyle = {
  flexDirection: "row",
  alignItems: "center",
  flexGap: spacing.xxs,
};

const trackingDotStyle: FlexWidgetStyle = {
  width: 6,
  height: 6,
  borderRadius: radii.full,
};

const trackingLabelStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "600",
  letterSpacing: 0.3,
  color: colors.mutedForeground,
};

const trackingElapsedStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "700",
  color: colors.foreground,
};

const trackingTitleStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  fontWeight: "600",
  color: colors.foreground,
};

const trackingSubtitleStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  color: colors.mutedForeground,
};

const progressTrackStyle: FlexWidgetStyle = {
  flexDirection: "row",
  height: 4,
  borderRadius: radii.full,
  backgroundColor: colors.secondary,
  overflow: "hidden",
};

const blockTopRowStyle: FlexWidgetStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
};

const accentDotStyle: FlexWidgetStyle = {
  width: 10,
  height: 10,
  borderRadius: radii.full,
};

function statusChipStyle(isActive: boolean): FlexWidgetStyle {
  return {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.full,
    // "Now" mirrors TimelineBlock.tsx's own `NowBadge` (brand-yellow fill);
    // "Next" stays neutral so the brand color keeps meaning "happening now"
    // everywhere it appears in the app, this widget included.
    backgroundColor: isActive ? colors.primary : colors.secondary,
  };
}

function statusChipTextStyle(isActive: boolean): TextWidgetStyle {
  return {
    fontSize: typography.size.twoxs,
    fontWeight: "600",
    letterSpacing: 0.5,
    color: isActive ? colors.primaryForeground : colors.mutedForeground,
  };
}

const blockTitleStyle: TextWidgetStyle = {
  fontSize: typography.size.md,
  fontWeight: "700",
  color: colors.foreground,
};

const blockTimeStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  color: colors.mutedForeground,
};

const statValueStyle: TextWidgetStyle = {
  fontSize: typography.size.xxl,
  fontWeight: "700",
  letterSpacing: -1,
  color: colors.foreground,
};
