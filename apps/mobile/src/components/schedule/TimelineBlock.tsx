// A single scheduled block, positioned on the time axis.
//
// Visual language mirrors dw-time-web/src/features/schedule/components/
// schedule-grid/draggable-block.tsx: a saturated left rail in the block's
// category color over a ~10% tint of that same color (`borderLeftColor:
// accentColor` + `backgroundColor: ${accentColor}1a`), a bold uppercase title,
// and progressively less content as the block gets shorter. The goal / private
// / task affordances are the same three that component surfaces.
//
// What's mobile-only: past/active styling (the web has no per-block notion of
// "now" — it puts an "Active now" banner above the grid instead, see
// schedule-page.tsx), a spring press response, and the staggered entrance,
// because on a phone the day swaps in place and motion is what tells you the
// content actually changed.
//
// Radius/spacing language, held across every element here and in the sibling
// components: surfaces use radii.lg, anything inline and pill-shaped uses
// radii.full, and every gap/padding is a `spacing` token (4pt rhythm). No
// literal numbers.

import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { formatDuration, formatTime12h, type ScheduleBlock } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

import { blockDensity, withAlpha, type BlockStatus, type PositionedBlock } from "./layout";

const PRESS_SPRING = { damping: 20, stiffness: 300 } as const;
const STAGGER_MS = 40;
const ENTER_MS = 220;
/** Web: `backgroundColor: ${accentColor}1a` in draggable-block.tsx. */
const TINT_ALPHA = "1A";
const PAST_TINT_ALPHA = "0F";
/** Width of the category color rail. Web: `border-l-4`. */
const RAIL_WIDTH = 4;

export interface TimelineBlockProps {
  entry: PositionedBlock;
  status: BlockStatus;
  /** Position in the day's sorted list — drives the entrance stagger only. */
  index: number;
  top: number;
  height: number;
  onPress: (block: ScheduleBlock) => void;
}

export const TimelineBlock = memo(function TimelineBlock({
  entry,
  status,
  index,
  top,
  height,
  onPress,
}: TimelineBlockProps) {
  const { block, column, columnCount } = entry;
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = useCallback(() => onPress(block), [block, onPress]);

  const density = blockDensity(height);
  const isPast = status === "past";
  const isActive = status === "active";

  // A linked goal's own color wins over the block's, matching the web's
  // `block.goal?.category || block.category` accent resolution.
  const accent = block.goal?.color ?? block.color;
  const tint = withAlpha(accent, isPast ? PAST_TINT_ALPHA : TINT_ALPHA);

  const positionStyle: ViewStyle = {
    top,
    height,
    left: `${(column / columnCount) * 100}%`,
    width: `${(1 / columnCount) * 100}%`,
  };

  const timeRange = `${formatTime12h(block.startTime)} – ${formatTime12h(block.endTime)}`;
  const duration = formatDuration(entry.endMin - entry.startMin);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * STAGGER_MS).duration(ENTER_MS)}
      style={[styles.slot, positionStyle]}
    >
      <Pressable
        style={styles.pressable}
        onPress={handlePress}
        onPressIn={() => {
          scale.value = withSpring(0.975, PRESS_SPRING);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, PRESS_SPRING);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${block.title}, ${timeRange}`}
        accessibilityHint="Opens block details"
      >
        <Animated.View
          style={[
            styles.card,
            { borderLeftColor: accent, backgroundColor: tint ?? colors.secondary },
            isActive && styles.cardActive,
            isPast && styles.cardPast,
            pressStyle,
          ]}
        >
          <View style={styles.titleRow}>
            {block.isPrivate ? (
              // Web uses a Lock glyph here; the closest member of the shared
              // mobile Icon set for "hidden from people you share with".
              <Icon name="eye-off" size={12} color={colors.mutedForeground} />
            ) : null}
            <Text
              style={[styles.title, density === "tiny" && styles.titleTiny, isPast && styles.mutedText]}
              numberOfLines={1}
            >
              {block.title}
            </Text>
            {isActive ? <NowBadge /> : null}
            {/* Distinguishes a queued create/edit (still offline, waiting to
                sync) from a genuinely-saved block — the two would otherwise
                render identically. See ScheduleBlock.pendingSync's own
                header note for where this gets set. */}
            {block.pendingSync ? <PendingBadge /> : null}
          </View>

          {density !== "tiny" ? (
            <Text style={[styles.time, isPast && styles.mutedText]} numberOfLines={1}>
              {timeRange}
            </Text>
          ) : null}

          {density === "full" ? (
            <View style={styles.metaRow}>
              <Chip icon="timer" label={duration} muted={isPast} />
              {block.goal ? <Chip icon="goals" label={block.goal.title} muted={isPast} /> : null}
              {block.tasks && block.tasks.length > 0 ? (
                <Chip icon="tasks" label={String(block.tasks.length)} muted={isPast} />
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

/**
 * The "happening right now" marker. The web puts this information in a banner
 * above the grid (schedule-page.tsx's `activeBlock` call-out); on a phone the
 * banner would push the timeline down, so the emphasis lives on the block.
 */
function NowBadge() {
  return (
    <View style={styles.nowBadge}>
      <Text style={styles.nowBadgeText}>Now</Text>
    </View>
  );
}

/** "Queued" marker for a block that's still sitting in the offline outbox. */
function PendingBadge() {
  return (
    <View style={styles.pendingBadge}>
      <Icon name="refresh" size={10} color={colors.mutedForeground} />
    </View>
  );
}

function Chip({ icon, label, muted }: { icon: "timer" | "goals" | "tasks"; label: string; muted: boolean }) {
  return (
    <View style={styles.chip}>
      <Icon name={icon} size={11} color={muted ? colors.border : colors.mutedForeground} />
      <Text style={[styles.chipText, muted && styles.mutedText]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const CHIP_MAX_WIDTH = 148;

const styles = StyleSheet.create({
  slot: {
    position: "absolute",
    // Lanes sit flush; the inner card's right padding is the visible gutter
    // between two concurrent blocks.
    paddingRight: spacing.xxs,
  },
  pressable: {
    flex: 1,
  },
  card: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    // Web: `border border-l-4` — the rail is how the category color reads at
    // a glance, which a small dot never managed.
    borderLeftWidth: RAIL_WIDTH,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
  },
  cardActive: {
    borderTopColor: colors.primary,
    borderRightColor: colors.primary,
    borderBottomColor: colors.primary,
    ...shadows.card,
  },
  // Past blocks recede rather than vanish — the day's history is still part of
  // reading the schedule, it just shouldn't compete with what's next.
  cardPast: {
    opacity: 0.55,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
    // Web: `font-bold uppercase leading-tight` on the block title.
    ...typography.body,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.2,
    color: colors.foreground,
  },
  titleTiny: {
    ...typography.caption,
    letterSpacing: 0.2,
  },
  time: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  mutedText: {
    color: colors.mutedForeground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  // Mirrors the web's `border ... bg-white/70` meta chip in schedule-page.tsx:
  // a light surface pill that stays legible on top of any category tint.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: CHIP_MAX_WIDTH,
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    flexShrink: 1,
    ...typography.label,
    letterSpacing: 0.2,
    color: colors.mutedForeground,
  },
  nowBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  nowBadgeText: {
    ...typography.label,
    // Dark ink on brand yellow, never white.
    color: colors.primaryForeground,
  },
  pendingBadge: {
    width: 16,
    height: 16,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
});
