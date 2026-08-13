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
//
// LAYOUT INTENT — the widget is freely resizable (app.json's `resizeMode`
// spans 140-600dp wide, 80-450dp tall), so every section here has to survive
// both extremes. The rule that keeps it honest at a large size: nothing is
// vertically centred in the card, and the one element allowed to absorb
// slack is the accent bar, which stretches. Earlier revisions centred the
// content, which left a dead gap above it on a tall resize; anchoring it to
// the top instead just moved the same gap below. A stretching colour bar is
// what makes the leftover space read as deliberate rather than as a
// half-empty card.

import { FlexWidget, TextWidget, type FlexWidgetStyle, type TextWidgetStyle } from "react-native-android-widget";

import { scheduleDayDeepLink, timerAutoStartDeepLink, timerDeepLink, type ScheduleDayOfWeek } from "@/lib/deep-links";
import { colors, radii, spacing, typography } from "@/theme";

import type { WidgetTrackingState, WidgetViewState } from "./widget-data";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Validates a block/category color before handing it to a widget primitive — `ColorProp` is typed as a literal `#RRGGBB` template, but the value coming off the API is just `string`. Falls back to a safe theme color for anything malformed rather than letting the native draw call fail. */
function toHexColor(color: string, fallback: `#${string}`): `#${string}` {
  return HEX_COLOR_RE.test(color) ? (color as `#${string}`) : fallback;
}

/**
 * `#RRGGBB` → `#RRGGBBAA`. RemoteViews itself wants ARGB, but this library's
 * `convertColor` (widgets/utils/style.utils.ts) takes CSS-order 8-digit hex
 * — alpha *trailing* — and reorders it to Android's native AARRGGBB
 * internally. Passing alpha-leading here double-reorders it: an 8-digit hex
 * with the alpha already in front gets its *last* two characters read back
 * out as the alpha byte instead, which doesn't error, it just silently
 * renders a wildly wrong colour (this shipped once — an intended 11% tint
 * rendered as a near-opaque near-black panel).
 */
function withAlpha(color: `#${string}`, alpha: string): `#${string}` {
  return `${color}${alpha}` as `#${string}`;
}

/** Tint strength for the panel behind block content — enough to read as a surface in the block's own colour without competing with the foreground text. Same idea as the iOS widget's `accent.opacity(0.11)` panel fill. */
const PANEL_TINT_ALPHA = "1C";
/** The accent bar and track button fade toward their trailing edge rather than sitting flat — `0xB8/0xFF ≈ 0.72`, the same fade the iOS widget's `accent.opacity(0.72)` gradient stop uses. */
const FADE_ALPHA = "B8";

/** `Date#getDay()` is typed as plain `number`; it is always 0-6 at runtime, which is exactly what `ScheduleDayOfWeek` narrows to. */
function todayDeepLink(): string {
  return scheduleDayDeepLink(new Date().getDay() as ScheduleDayOfWeek);
}

/**
 * Under this height the widget is roughly two home-screen rows and the
 * time-range line is the first thing that has to go — the title and status
 * chip alone still answer "what's on right now", which a one-glance widget
 * needs; the exact clock times are what you open the app for. Measured
 * against `app.json`'s `minHeight` (80dp) plus a row of headroom.
 */
const TIGHT_HEIGHT_DP = 130;

export interface TodayWidgetProps {
  state: WidgetViewState;
  /** What's actually being tracked right now, independent of `state` — see widget-data.ts's `loadWidgetTrackingState`. `null` while idle. */
  tracking: WidgetTrackingState | null;
  /** Current widget height in dp, from `widgetTaskHandler`'s `widgetInfo.height` — react-native-android-widget gives no "size class" the way iOS's `.widgetFamily` does, so this is the only signal available for how much content fits. */
  heightDp: number;
}

export function TodayWidget({ state, tracking, heightDp }: TodayWidgetProps) {
  // Tapping the widget while a session is running goes to the Timer tab
  // (there's something live to look at); otherwise it goes to today's
  // schedule, same as before tracking existed.
  const rootDeepLink = tracking ? timerDeepLink() : todayDeepLink();
  const isTight = heightDp < TIGHT_HEIGHT_DP;
  return (
    <FlexWidget
      style={rootStyle}
      clickAction="OPEN_URI"
      clickActionData={{ uri: rootDeepLink }}
      accessibilityLabel={tracking ? "Open GoalSlot timer" : "Open GoalSlot schedule"}
    >
      <Header state={state} />
      <Body state={state} tracking={tracking} isTight={isTight} />
      {tracking && <TrackingBand tracking={tracking} isTight={isTight} />}
    </FlexWidget>
  );
}

/**
 * The eyebrow row doubles as the day's progress readout: "3/8 done" sits
 * opposite "TODAY" rather than in a section of its own. That's what lets a
 * wide widget use its horizontal space instead of growing another band, and
 * it means progress is visible at every size instead of only on a tall one.
 */
function Header({ state }: { state: WidgetViewState }) {
  const progress =
    state.kind === "block"
      ? `${state.dayProgress.done}/${state.dayProgress.total} done`
      : state.kind === "progress"
        ? `${state.done}/${state.total} done`
        : null;
  return (
    <FlexWidget style={headerStyle}>
      <FlexWidget style={headerLeftStyle}>
        <FlexWidget style={brandDotStyle} />
        <TextWidget text="TODAY" style={eyebrowStyle} />
      </FlexWidget>
      {progress !== null && <TextWidget text={progress} style={headerProgressStyle} />}
    </FlexWidget>
  );
}

function Body({
  state,
  tracking,
  isTight,
}: {
  state: WidgetViewState;
  tracking: WidgetTrackingState | null;
  isTight: boolean;
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
          isTight={isTight}
        />
      );
    case "progress":
      return (
        <MessageBody
          accent={colors.primary}
          headline={state.done >= state.total && state.total > 0 ? "All done for today" : "Nothing left today"}
          detail={state.done >= state.total && state.total > 0 ? "Nice work." : "Your remaining blocks are finished."}
        />
      );
    case "empty-day":
      return <MessageBody accent={colors.border} headline="Nothing scheduled" detail="Your day is wide open." />;
    case "unavailable":
      return <MessageBody accent={colors.border} headline="Open GoalSlot" detail="Tap to view your day." />;
  }
}

/**
 * The block's own colour, as a bar down the left edge. This is the element
 * that stretches (`height: "match_parent"` inside a `flex: 1` row), so extra
 * height on a large resize lands here instead of pooling as blank card —
 * see this file's LAYOUT INTENT note. Fades top-to-bottom rather than
 * sitting flat, matching the iOS widget's accent bar.
 */
function AccentBar({ color }: { color: `#${string}` }) {
  return (
    <FlexWidget
      style={{
        ...accentBarStyle,
        backgroundGradient: { from: color, to: withAlpha(color, FADE_ALPHA), orientation: "TOP_BOTTOM" },
      }}
    />
  );
}

/**
 * The tinted surface a block/message/tracking row sits on — the bar's colour
 * carried into the card itself at low opacity, same idea as the iOS
 * widget's `accent.opacity(0.11)` panel fill. Kept as one function rather
 * than a static style since the accent varies per block.
 */
function panelStyle(accent: `#${string}`): FlexWidgetStyle {
  return { ...bodyRowStyle, backgroundColor: withAlpha(accent, PANEL_TINT_ALPHA) };
}

function BlockBody({
  status,
  block,
  showTrackButton,
  isTight,
}: {
  status: "active" | "upcoming";
  block: { title: string; timeRange: string; color: string; goalId?: string };
  showTrackButton: boolean;
  isTight: boolean;
}) {
  const isActive = status === "active";
  const accent = toHexColor(block.color, colors.primary);
  return (
    <FlexWidget style={panelStyle(accent)}>
      <AccentBar color={accent} />
      <FlexWidget style={bodyContentStyle}>
        <FlexWidget style={statusChipStyle(isActive)}>
          <TextWidget text={isActive ? "NOW" : "NEXT"} style={statusChipTextStyle(isActive)} />
        </FlexWidget>
        <TextWidget text={block.title} style={blockTitleStyle} truncate="END" maxLines={1} />
        {!isTight && <TextWidget text={block.timeRange} style={blockTimeStyle} truncate="END" maxLines={1} />}
      </FlexWidget>
      {showTrackButton && block.goalId && <TrackButton goalId={block.goalId} />}
    </FlexWidget>
  );
}

/** Its own `clickAction`, separate from the root widget's — tapping it starts tracking directly instead of just opening the app. Mirrors the iOS widget's "Start" button (targets/widget/GoalSlotWidget.swift). */
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

/** The non-block states (nothing scheduled / all done / signed out). Keeps the same bar-plus-content anatomy as `BlockBody` so the widget doesn't restructure itself between states — only the copy and the bar colour change. */
function MessageBody({
  accent,
  headline,
  detail,
}: {
  accent: `#${string}`;
  headline: string;
  detail: string;
}) {
  return (
    <FlexWidget style={panelStyle(accent)}>
      <AccentBar color={accent} />
      <FlexWidget style={bodyContentStyle}>
        <TextWidget text={headline} style={blockTitleStyle} truncate="END" maxLines={1} />
        <TextWidget text={detail} style={blockTimeStyle} truncate="END" maxLines={1} />
      </FlexWidget>
    </FlexWidget>
  );
}

/**
 * A persistent footer for "what's being tracked right now" — shown
 * regardless of what the schedule body above is displaying, since the two
 * can disagree (e.g. tracking a goal that isn't one of today's scheduled
 * blocks). Task wins over its parent goal as the headline (`primaryLabel`),
 * with the goal as a subtitle when there is one — see widget-data.ts's
 * `loadWidgetTrackingState`.
 */
function TrackingBand({ tracking, isTight }: { tracking: WidgetTrackingState; isTight: boolean }) {
  const isPaused = tracking.status === "paused";
  const accent = isPaused ? colors.mutedForeground : colors.primary;
  return (
    <FlexWidget style={{ ...trackingBandStyle, backgroundColor: withAlpha(accent, PANEL_TINT_ALPHA) }}>
      <FlexWidget style={trackingHeaderRowStyle}>
        <FlexWidget style={trackingStatusGroupStyle}>
          <FlexWidget style={{ ...trackingDotStyle, backgroundColor: accent }} />
          <TextWidget text={isPaused ? "PAUSED" : "TRACKING"} style={trackingLabelStyle} />
          <TextWidget text={tracking.primaryLabel} style={trackingTitleStyle} truncate="END" maxLines={1} />
        </FlexWidget>
        <TextWidget text={tracking.elapsedLabel} style={trackingElapsedStyle} />
      </FlexWidget>
      {!isTight && tracking.secondaryLabel && (
        <TextWidget text={tracking.secondaryLabel} style={trackingSubtitleStyle} truncate="END" maxLines={1} />
      )}
      <ProgressBar progress={tracking.progress} accent={accent} />
    </FlexWidget>
  );
}

/**
 * A flexbox-ratio trick, not a native progress primitive (the library
 * doesn't have one): a fixed-height row split into a filled leading segment
 * and an empty trailing one, sized via `flex` the same way `flex-grow`
 * would size two siblings — see widget-data.ts's
 * `WidgetTrackingState.progress` for why this isn't live-ticking.
 */
function ProgressBar({ progress, accent }: { progress: number; accent: `#${string}` }) {
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <FlexWidget style={progressTrackStyle}>
      <FlexWidget style={{ flex: filled, height: "match_parent", backgroundColor: accent }} />
      <FlexWidget style={{ flex: 1 - filled, height: "match_parent" }} />
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
  padding: spacing.md,
};

const headerStyle: FlexWidgetStyle = {
  width: "match_parent",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
};

const headerLeftStyle: FlexWidgetStyle = {
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
  backgroundGradient: { from: colors.primary, to: withAlpha(colors.primary, FADE_ALPHA), orientation: "TL_BR" },
};

const eyebrowStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "600",
  letterSpacing: 0.8,
  color: colors.mutedForeground,
};

const headerProgressStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "600",
  letterSpacing: 0.3,
  color: colors.mutedForeground,
};

/** `flex: 1` is what hands the leftover card height to this row (and so to the accent bar inside it) rather than leaving it as blank space at one end. Also the base a tinted panel is built from — see `panelStyle`. */
const bodyRowStyle: FlexWidgetStyle = {
  flex: 1,
  width: "match_parent",
  flexDirection: "row",
  alignItems: "center",
  marginTop: spacing.sm,
  marginBottom: spacing.sm,
  borderRadius: radii.lg,
  padding: spacing.sm,
};

const accentBarStyle: FlexWidgetStyle = {
  width: 5,
  height: "match_parent",
  borderRadius: radii.full,
  marginRight: spacing.md,
};

const bodyContentStyle: FlexWidgetStyle = {
  flex: 1,
  flexDirection: "column",
  flexGap: spacing.xxs,
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

// 18px, up from the row-title 16px the app uses inside a list: the widget
// shows exactly one block, so its title is the whole point of the surface
// rather than one row among many.
const blockTitleStyle: TextWidgetStyle = {
  fontSize: typography.size.lg,
  fontWeight: "700",
  color: colors.foreground,
};

const blockTimeStyle: TextWidgetStyle = {
  fontSize: typography.size.xs,
  color: colors.mutedForeground,
};

const trackButtonStyle: FlexWidgetStyle = {
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.sm,
  marginLeft: spacing.sm,
  borderRadius: radii.full,
  // A gradient capsule rather than a flat fill — same fade the accent bar
  // uses, matching the iOS widget's Start button.
  backgroundGradient: { from: colors.primary, to: withAlpha(colors.primary, FADE_ALPHA), orientation: "TOP_BOTTOM" },
};

const trackButtonTextStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  fontWeight: "600",
  color: colors.primaryForeground,
};

/** Tinted the same way `panelStyle` tints a block row (see `TrackingBand`), so the running-session panel reads as the same kind of surface rather than a plain divider-and-text strip. */
const trackingBandStyle: FlexWidgetStyle = {
  width: "match_parent",
  flexDirection: "column",
  flexGap: spacing.xs,
  marginTop: spacing.xs,
  borderRadius: radii.lg,
  padding: spacing.sm,
};

const trackingHeaderRowStyle: FlexWidgetStyle = {
  width: "match_parent",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
};

const trackingStatusGroupStyle: FlexWidgetStyle = {
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  flexGap: spacing.xs,
};

const trackingDotStyle: FlexWidgetStyle = {
  width: 6,
  height: 6,
  borderRadius: radii.full,
};

const trackingLabelStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  fontWeight: "600",
  letterSpacing: 0.5,
  color: colors.mutedForeground,
};

const trackingTitleStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  fontWeight: "600",
  color: colors.foreground,
};

const trackingElapsedStyle: TextWidgetStyle = {
  fontSize: typography.size.sm,
  fontWeight: "700",
  color: colors.foreground,
};

const trackingSubtitleStyle: TextWidgetStyle = {
  fontSize: typography.size.twoxs,
  color: colors.mutedForeground,
};

const progressTrackStyle: FlexWidgetStyle = {
  width: "match_parent",
  flexDirection: "row",
  height: 4,
  borderRadius: radii.full,
  backgroundColor: colors.secondary,
};
