// Loading placeholder shaped like the timeline it stands in for.
//
// The screen used to show generic `SkeletonListItem` rows, which promised a
// flat list and then resolved into a positioned canvas — the layout visibly
// jumped. This draws the same gutter + hour rules + offset blocks the real
// Timeline draws, so the transition is a fade rather than a re-layout.

import { StyleSheet, View } from "react-native";

import { Skeleton } from "@/components/Skeleton";
import { colors, radii, spacing } from "@/theme/tokens";

import { GUTTER_WIDTH, HOUR_HEIGHT } from "./layout";

/** Top offset (in hour-multiples) and height for each placeholder block. */
const PLACEHOLDER_BLOCKS = [
  { top: 0.3, hours: 1 },
  { top: 1.6, hours: 0.6 },
  { top: 2.5, hours: 1.4 },
  { top: 4.3, hours: 0.8 },
];
const ROW_COUNT = 6;

export function TimelineSkeleton() {
  return (
    <View style={[styles.canvas, { height: ROW_COUNT * HOUR_HEIGHT + spacing.xxl }]}>
      {Array.from({ length: ROW_COUNT }).map((_, index) => (
        <View key={index} style={[styles.hourRow, { top: index * HOUR_HEIGHT }]} />
      ))}

      {Array.from({ length: ROW_COUNT }).map((_, index) => (
        <View key={`label-${index}`} style={[styles.hourLabel, { top: index * HOUR_HEIGHT - spacing.xs }]}>
          <Skeleton width={26} height={8} borderRadius={radii.sm} style={styles.hourLabelSkeleton} />
        </View>
      ))}

      {PLACEHOLDER_BLOCKS.map((block) => (
        <View
          key={block.top}
          style={[styles.block, { top: block.top * HOUR_HEIGHT, height: block.hours * HOUR_HEIGHT }]}
        >
          <Skeleton width="100%" height="100%" borderRadius={radii.lg} />
        </View>
      ))}
    </View>
  );
}

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
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  // Right-aligned within the same gutter width the real Timeline's hour
  // labels occupy (GUTTER_WIDTH - spacing.sm, textAlign "right"), rather
  // than a flush-left box that used to land in a different spot the moment
  // real data swapped in.
  hourLabel: {
    position: "absolute",
    left: 0,
    width: GUTTER_WIDTH - spacing.sm,
    alignItems: "flex-end",
  },
  hourLabelSkeleton: {
    marginRight: spacing.xxs,
  },
  block: {
    position: "absolute",
    left: GUTTER_WIDTH,
    right: spacing.sm,
  },
});
