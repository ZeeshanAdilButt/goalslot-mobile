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

import { scheduleDayDeepLink, type ScheduleDayOfWeek } from "@/lib/deep-links";
import { colors, radii, spacing, typography } from "@/theme";

import type { WidgetViewState } from "./widget-data";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Validates a block/category color before handing it to a widget primitive — `ColorProp` is typed as a literal `#RRGGBB` template, but the value coming off the API is just `string`. Falls back to a safe theme color for anything malformed rather than letting the native draw call fail. */
function toHexColor(color: string, fallback: `#${string}`): `#${string}` {
  return HEX_COLOR_RE.test(color) ? (color as `#${string}`) : fallback;
}

/** `Date#getDay()` is typed as plain `number`; it is always 0-6 at runtime, which is exactly what `ScheduleDayOfWeek` narrows to. */
function todayDeepLink(): string {
  return scheduleDayDeepLink(new Date().getDay() as ScheduleDayOfWeek);
}

export interface TodayWidgetProps {
  state: WidgetViewState;
}

export function TodayWidget({ state }: TodayWidgetProps) {
  return (
    <FlexWidget
      style={rootStyle}
      clickAction="OPEN_URI"
      clickActionData={{ uri: todayDeepLink() }}
      accessibilityLabel="Open GoalSlot schedule"
    >
      <Header />
      <FlexWidget style={bodyStyle}>
        <Body state={state} />
      </FlexWidget>
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

function Body({ state }: { state: WidgetViewState }) {
  switch (state.kind) {
    case "block":
      return <BlockBody status={state.status} block={state.block} />;
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
}: {
  status: "active" | "upcoming";
  block: { title: string; timeRange: string; color: string };
}) {
  const isActive = status === "active";
  return (
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

const bodyStyle: FlexWidgetStyle = {
  flex: 1,
  flexDirection: "column",
  justifyContent: "center",
};

const blockColumnStyle: FlexWidgetStyle = {
  flexDirection: "column",
  flexGap: spacing.xxs,
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
