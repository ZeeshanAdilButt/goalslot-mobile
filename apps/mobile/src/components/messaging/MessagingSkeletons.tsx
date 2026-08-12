// Loading placeholders shaped like the content they stand in for.
//
// `SkeletonListItem` (the shared one) is a small leading dot plus two text
// lines, which is right for Today/Tasks rows and wrong here: a conversation
// row leads with a 44pt avatar, so the generic placeholder visibly pops into
// a much taller row when the data lands. Same for a thread — a column of
// identical grey bars reads as a list, not as a conversation, so the bubble
// placeholders alternate sides and vary in width.

import { StyleSheet, View } from "react-native";

import { Skeleton } from "@/components/Skeleton";
import { colors, minTouchTarget, radii, spacing } from "@/theme/tokens";

const AVATAR_SIZE = 44;
const CONVERSATION_ROWS = 7;

/** Deterministic per-index widths — random ones would reshuffle on every render. */
const PREVIEW_WIDTHS = ["78%", "54%", "88%", "62%", "71%", "45%", "83%"] as const;
const BUBBLE_WIDTHS = [180, 120, 240, 96, 210, 140] as const;

export function ConversationListSkeleton() {
  return (
    <View accessibilityLabel="Loading conversations" accessibilityRole="progressbar">
      {Array.from({ length: CONVERSATION_ROWS }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} borderRadius={radii.pill} />
          <View style={styles.rowBody}>
            <Skeleton width="42%" height={14} />
            <Skeleton width={PREVIEW_WIDTHS[index % PREVIEW_WIDTHS.length]} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ThreadSkeleton() {
  return (
    <View style={styles.thread} accessibilityLabel="Loading messages" accessibilityRole="progressbar">
      {BUBBLE_WIDTHS.map((width, index) => (
        <View key={index} style={index % 2 === 0 ? styles.bubbleOther : styles.bubbleOwn}>
          <Skeleton width={width} height={38} borderRadius={radii.lg} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: minTouchTarget + spacing.xl,
  },
  rowBody: {
    flex: 1,
    gap: spacing.sm,
  },
  thread: {
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  bubbleOwn: {
    alignSelf: "flex-end",
  },
  bubbleOther: {
    alignSelf: "flex-start",
  },
});
