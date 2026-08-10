// What a day with nothing on it looks like.
//
// Mirrors dw-time-web/src/features/schedule/components/schedule-empty-state.tsx
// beat for beat — an illustration, a short headline, one line of "here's why
// this matters" copy, and a single brand CTA — including its actual sentence
// about the Coach, so the two platforms say the same thing.
//
// The illustration is inline SVG rather than an icon glyph because the web's
// lone CalendarPlus icon leaves a phone-sized empty area looking unfinished.
// Drawing a miniature of the timeline the user is about to fill (hour rules,
// two colored blocks, the now line) explains the screen far better than a
// generic calendar symbol, and it costs no new dependency — react-native-svg
// is already installed for the Icon set.

import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface ScheduleEmptyStateProps {
  /** Full weekday name, e.g. "Tuesday". */
  dayLabel: string;
  onAddBlock: () => void;
}

export function ScheduleEmptyState({ dayLabel, onAddBlock }: ScheduleEmptyStateProps) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.card}>
      <Animated.View entering={FadeInDown.delay(60).duration(280)}>
        <TimelineSketch />
      </Animated.View>

      <View style={styles.copy}>
        <Text style={styles.headline}>{dayLabel} is wide open</Text>
        <Text style={styles.description}>
          Scheduling time against a goal keeps the Coach informed and your focus intentional.
        </Text>
      </View>

      <Pressable
        style={styles.cta}
        onPress={onAddBlock}
        accessibilityRole="button"
        accessibilityLabel="Add your first block"
      >
        <Icon name="add" size={16} color={colors.primaryForeground} />
        <Text style={styles.ctaText}>Add your first block</Text>
      </Pressable>
    </Animated.View>
  );
}

const SKETCH_WIDTH = 168;
const SKETCH_HEIGHT = 116;

/**
 * A miniature of a filled day: the hour rules this screen draws, two blocks
 * with their category rails, and the now line. Every color is a theme token.
 */
function TimelineSketch() {
  return (
    <Svg width={SKETCH_WIDTH} height={SKETCH_HEIGHT} accessibilityElementsHidden importantForAccessibility="no">
      {/* Hour rules */}
      {[16, 42, 68, 94].map((y) => (
        <Line
          key={y}
          x1={26}
          x2={SKETCH_WIDTH - 8}
          y1={y}
          y2={y}
          stroke={colors.border}
          strokeWidth={1}
          strokeDasharray="3 5"
        />
      ))}

      {/* Gutter tick marks standing in for hour labels */}
      {[16, 42, 68, 94].map((y) => (
        <Rect key={`t${y}`} x={6} y={y - 2} width={14} height={4} rx={2} fill={colors.border} />
      ))}

      {/* Two blocks: one brand-accented, one neutral — sized differently so the
          sketch shows that height means duration. */}
      <Rect x={30} y={20} width={92} height={18} rx={5} fill={colors.warningMuted} />
      <Rect x={30} y={20} width={3} height={18} rx={1.5} fill={colors.primary} />

      <Rect x={30} y={48} width={116} height={34} rx={5} fill={colors.secondary} />
      <Rect x={30} y={48} width={3} height={34} rx={1.5} fill={colors.mutedForeground} />

      {/* Now line */}
      <Line x1={26} x2={SKETCH_WIDTH - 8} y1={88} y2={88} stroke={colors.primaryDark} strokeWidth={2} />
      <Circle cx={28} cy={88} r={4} fill={colors.primaryDark} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: {
    alignItems: "center",
    gap: spacing.xs,
  },
  headline: {
    ...typography.title,
    color: colors.foreground,
    textAlign: "center",
  },
  description: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  ctaText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
