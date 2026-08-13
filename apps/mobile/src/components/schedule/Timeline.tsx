// The time axis itself: hour labels down the left, a real hour row grid, the
// positioned blocks, and the live "now" line.
//
// Mirrors dw-time-web/src/features/schedule/components/schedule-grid/
// schedule-grid.tsx (a fixed-width left column of hour labels rendered as
// `{hour}` + a small uppercase AM/PM) and .../day-column.tsx, which draws one
// rule per hour down every day column. The grid is not decoration: it's what
// makes an empty 10am–1pm stretch read as three empty hours instead of as a
// gap between two cards.
//
// The hour rows are real Pressables rather than painted lines because the web
// canvas is click-to-create (schedule-grid.tsx's `handlePointerDown` turns a
// press on empty column space into a new block), so empty space is an
// affordance on both platforms, not dead pixels.

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { type ScheduleBlock } from "@goalslot/shared";

import { colors, radii, spacing, typography } from "@/theme/tokens";

import {
  blockStatus,
  CANVAS_BOTTOM_PADDING,
  formatHourLabel,
  GUTTER_WIDTH,
  HOUR_HEIGHT,
  isWithinWindow,
  MIN_BLOCK_HEIGHT,
  minuteToY,
  PX_PER_MIN,
  windowHeight,
  type DayWindow,
  type PositionedBlock,
} from "./layout";
import { NowIndicator } from "./NowIndicator";
import { TimelineBlock } from "./TimelineBlock";

export interface TimelineProps {
  window: DayWindow;
  entries: readonly PositionedBlock[];
  /** Minute-of-day for "now", or null when the selected day isn't today. */
  nowMinutes: number | null;
  onSelectBlock: (block: ScheduleBlock) => void;
  /**
   * Press on an empty hour row — the web's click-empty-space-to-create. Gets
   * the hour that was pressed (0-23) so the create sheet can open on the time
   * the row's own label already promises.
   */
  onPressEmptyHour: (hour: number) => void;
}

export const Timeline = memo(function Timeline({
  window,
  entries,
  nowMinutes,
  onSelectBlock,
  onPressEmptyHour,
}: TimelineProps) {
  const gridHeight = windowHeight(window);
  const canvasHeight = gridHeight + CANVAS_BOTTOM_PADDING;
  // One row per hour in the window; the final label marks the closing edge.
  const rows = Array.from({ length: window.endHour - window.startHour }, (_, i) => window.startHour + i);
  const labels = [...rows, window.endHour];
  const showNow = nowMinutes !== null && isWithinWindow(nowMinutes, window);

  return (
    <View style={[styles.canvas, { height: canvasHeight }]}>
      {/* Layer 1 — the hour grid. Each row owns its own top hairline so the
          rules line up exactly with the labels beside them. */}
      {rows.map((hour) => (
        <Pressable
          key={hour}
          style={[styles.hourRow, { top: minuteToY(hour * 60, window) }]}
          onPress={() => onPressEmptyHour(hour)}
          accessibilityRole="button"
          accessibilityLabel={`Add a block at ${formatHourLabel(hour)}`}
        />
      ))}
      <View style={[styles.closingRule, { top: minuteToY(window.endHour * 60, window) }]} />

      {/* Layer 2 — hour labels in the gutter, sitting on their own rule. */}
      {labels.map((hour) => (
        <Text
          key={hour}
          style={[
            styles.hourLabel,
            {
              // Every label is nudged up by half its line box so it centres
              // on the rule it belongs to — except the very first, which has
              // no rule above it to centre against. Nudging it anyway pushed
              // its top past the canvas's own top edge into negative space,
              // which `overflow: "hidden"` on the canvas then clipped: the
              // window always starts at hour 0 now (see layout.ts), so this
              // was "12 AM" specifically, visibly cut off at the top of the
              // day. Nothing else here changes — scroll-to-now positioning
              // (schedule.tsx's `pendingScrollY`) is computed from
              // `minuteToY` directly and doesn't read this offset.
              top:
                hour === window.startHour
                  ? minuteToY(hour * 60, window)
                  : minuteToY(hour * 60, window) - HOUR_LABEL_OFFSET,
            },
          ]}
          numberOfLines={1}
          // Decorative scaffolding: every block already announces its own time
          // range, so a screen reader shouldn't have to walk 16 hour labels.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {formatHourLabel(hour)}
        </Text>
      ))}

      {/* Layer 3 — blocks. `box-none` so a press that lands in a gap between
          blocks still reaches the hour row underneath it. */}
      <View style={styles.blockLayer} pointerEvents="box-none">
        {entries.map((entry, index) => (
          <TimelineBlock
            key={entry.block.id}
            entry={entry}
            index={index}
            status={blockStatus(entry, nowMinutes)}
            top={minuteToY(entry.startMin, window)}
            height={Math.max(MIN_BLOCK_HEIGHT, (entry.endMin - entry.startMin) * PX_PER_MIN)}
            onPress={onSelectBlock}
          />
        ))}
      </View>

      {showNow && nowMinutes !== null ? (
        <NowIndicator top={minuteToY(nowMinutes, window)} minutes={nowMinutes} />
      ) : null}
    </View>
  );
});

/** Half the hour label's line box, so the text centres on its rule. */
const HOUR_LABEL_OFFSET = 6;

const styles = StyleSheet.create({
  canvas: {
    position: "relative",
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.sm,
    overflow: "hidden",
  },
  hourRow: {
    position: "absolute",
    left: GUTTER_WIDTH,
    right: 0,
    height: HOUR_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  closingRule: {
    position: "absolute",
    left: GUTTER_WIDTH,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  hourLabel: {
    position: "absolute",
    left: 0,
    width: GUTTER_WIDTH - spacing.sm,
    textAlign: "right",
    ...typography.label,
    color: colors.mutedForeground,
  },
  blockLayer: {
    position: "absolute",
    left: GUTTER_WIDTH,
    right: spacing.sm,
    top: 0,
    bottom: 0,
  },
});
