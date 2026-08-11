// One time block on the Today agenda.
//
// The web app renders the same data as a positioned box on a 2-D week grid
// (src/features/schedule/*) — an interaction that needs a pointer and a lot
// of width, and that mobile already has its own dedicated Schedule tab for.
// On Today the useful shape is a vertical timeline: a fixed time gutter, a
// connected rail, and the block content. The rail is what makes a list of
// three blocks read as "a day" rather than as three unrelated rows, which is
// the whole point of putting them on Today at all.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatDuration, formatTime12h, timeToMinutes, type ScheduleBlock } from "@goalslot/shared";

import { PressableScale } from "@/components/today/PressableScale";
import { colors, radii, spacing, typography } from "@/theme/tokens";

export interface TimelineRowProps {
  block: ScheduleBlock;
  /** Drops the connector below the dot so the rail terminates cleanly. */
  isLast: boolean;
  /** This block is happening right now — same block the hero is showing. */
  isNow: boolean;
  /** Opens the Schedule tab. Omit to render the row as static content. */
  onPress?: () => void;
}

/** "9:00 AM" -> ["9:00", "AM"] so the gutter can set them at two different sizes. */
function splitClock(time: string): [string, string] {
  const [clock, meridiem] = formatTime12h(time).split(" ");
  return [clock, meridiem ?? ""];
}

// Memoised because the Today screen re-renders once a minute to keep its
// "right now" state honest; without this, every block in the day's timeline
// re-renders on every tick even though only the active one can change.
export const TimelineRow = memo(function TimelineRow({ block, isLast, isNow, onPress }: TimelineRowProps) {
  const [clock, meridiem] = splitClock(block.startTime);
  const minutes = Math.max(0, timeToMinutes(block.endTime) - timeToMinutes(block.startTime));

  // A row that looks like a list row but swallows taps reads as a broken
  // control on touch. Falls back to a plain View when the caller has nowhere
  // to send the user.
  const Container = onPress ? PressableScale : View;
  const pressProps = onPress
    ? ({ onPress, accessibilityRole: "button", accessibilityHint: "Opens your schedule" } as const)
    : null;

  return (
    <Container
      style={styles.row}
      accessible
      accessibilityLabel={`${isNow ? "Now, " : ""}${block.title}, ${formatTime12h(
        block.startTime,
      )} to ${formatTime12h(block.endTime)}${block.category ? `, ${block.category}` : ""}`}
      {...pressProps}
    >
      <View style={styles.gutter}>
        <Text style={[styles.clock, isNow && styles.clockNow]}>{clock}</Text>
        <Text style={styles.meridiem}>{meridiem}</Text>
      </View>

      <View style={styles.rail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* The dot carries the block's own color; the white halo keeps a
            dark category color from bleeding into the connector line. */}
        <View style={[styles.dotHalo, isNow && styles.dotHaloNow]}>
          <View style={[styles.dot, { backgroundColor: block.color }]} />
        </View>
        {!isLast ? <View style={styles.connector} /> : null}
      </View>

      <View style={[styles.body, isNow && styles.bodyNow, isLast && styles.bodyLast]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {block.title}
          </Text>
          {isNow ? (
            <View style={styles.nowPill}>
              <Text style={styles.nowPillText}>Now</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.duration}>{formatDuration(minutes)}</Text>
          {block.category ? (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.category} numberOfLines={1}>
                {block.category}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Container>
  );
});

const GUTTER_WIDTH = 52;
const RAIL_WIDTH = 16;
const DOT_HALO = 16;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    minHeight: 56,
  },
  gutter: {
    width: GUTTER_WIDTH,
    alignItems: "flex-end",
    paddingTop: spacing.md,
  },
  clock: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: colors.foreground,
  },
  clockNow: {
    // Was `primaryForeground` (#18181B) — byte-identical to `foreground`,
    // so the "this block is happening now" emphasis rendered no differently
    // from every other row. `primaryText` (#A16207, yellow-700) is the
    // token foundation.ts documents as readable brand-colored TEXT; raw
    // #F2CC0D fails contrast on a light surface.
    color: colors.primaryText,
  },
  meridiem: {
    ...typography.label,
    fontSize: 9,
    color: colors.mutedForeground,
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: "center",
    paddingTop: spacing.md,
  },
  dotHalo: {
    width: DOT_HALO,
    height: DOT_HALO,
    borderRadius: DOT_HALO / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.card,
  },
  dotHaloNow: {
    borderColor: colors.primary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connector: {
    flex: 1,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bodyNow: {
    // Brand tint, not the warning tint — "now" is the app's accent moment,
    // and reusing `warningMuted` here made a normal active block share a
    // surface color with genuine warnings.
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.md,
    borderBottomWidth: 0,
  },
  bodyLast: {
    borderBottomWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: colors.foreground,
    flexShrink: 1,
  },
  nowPill: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  nowPillText: {
    ...typography.label,
    fontSize: 9,
    color: colors.primaryForeground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  duration: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.border,
  },
  category: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
    flexShrink: 1,
  },
});
