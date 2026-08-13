// Per-section empty state for the Today screen.
//
// The shared `@/components/EmptyState` is a single centered glyph + one line
// of text, and on Today that produced the exact failure users reported: a
// small grey circle stranded in ~70% white space. dw-time-web's own empty
// states are much more considered — see the "No active goals" card in
// src/features/dashboard/components/dashboard-goals.tsx:33-43, which pairs an
// illustration with a confident headline, a supporting line, AND a primary
// CTA so the state is a starting point rather than a dead end. This is that
// shape, plus a composed SVG illustration instead of a bare icon: concentric
// rings behind a tinted icon puck give the block enough visual mass to hold a
// card on its own.
//
// Deliberately local to `components/today/` rather than a change to the
// shared EmptyState — other screens' empty states are owned elsewhere.

import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Icon, type IconName } from "@/components/ui/Icon";
import { PressableScale } from "@/components/today/PressableScale";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const ILLUSTRATION_SIZE = 104;
const PUCK_SIZE = 52;

export interface SectionEmptyProps {
  headline: string;
  description: string;
  icon: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Brand-tinted illustration + solid brand CTA. Reserved for the hero;
   * repeating it on every section would turn the accent into wallpaper.
   */
  emphasis?: "brand" | "neutral";
  /** Tightens padding for empty states that sit inside an already-padded card. */
  compact?: boolean;
}

export function SectionEmpty({
  headline,
  description,
  icon,
  actionLabel,
  onAction,
  emphasis = "neutral",
  compact = false,
}: SectionEmptyProps) {
  const brand = emphasis === "brand";
  const ringColor = brand ? colors.primary : colors.border;
  const puckColor = brand ? colors.primary : colors.secondary;
  const glyphColor = brand ? colors.primaryForeground : colors.mutedForeground;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View
        style={styles.illustration}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* Two faint concentric rings — the "radiating" motif reads as
            potential/space-to-fill rather than as an error or a void. */}
        <Svg width={ILLUSTRATION_SIZE} height={ILLUSTRATION_SIZE} style={styles.illustrationCanvas}>
          <Circle
            cx={ILLUSTRATION_SIZE / 2}
            cy={ILLUSTRATION_SIZE / 2}
            r={ILLUSTRATION_SIZE / 2 - 1}
            stroke={ringColor}
            strokeWidth={1}
            strokeOpacity={0.35}
            fill="none"
          />
          <Circle
            cx={ILLUSTRATION_SIZE / 2}
            cy={ILLUSTRATION_SIZE / 2}
            r={ILLUSTRATION_SIZE / 2 - 15}
            stroke={ringColor}
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="3 5"
            fill="none"
          />
        </Svg>
        <View style={[styles.puck, { backgroundColor: puckColor }]}>
          <Icon name={icon} size={24} color={glyphColor} />
        </View>
      </View>

      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.description}>{description}</Text>

      {actionLabel && onAction ? (
        <PressableScale
          style={[styles.action, brand ? styles.actionBrand : styles.actionNeutral]}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={[styles.actionLabel, brand ? styles.actionLabelBrand : styles.actionLabelNeutral]}>
            {actionLabel}
          </Text>
          <Icon name="chevron" size={16} color={brand ? colors.primaryForeground : colors.foreground} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  containerCompact: {
    paddingVertical: spacing.xl,
  },
  illustration: {
    width: ILLUSTRATION_SIZE,
    height: ILLUSTRATION_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  illustrationCanvas: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  puck: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  headline: {
    // Was a hand-rolled 17px with no lineHeight — every other role in the
    // type scale pins one deliberately (see foundation.ts's note on why RN
    // needs it explicit), and `title` (16px/bold) is close enough to the old
    // number that swapping in the real token costs nothing visually while
    // gaining a stable line box.
    ...typography.title,
    color: colors.foreground,
    textAlign: "center",
  },
  description: {
    ...typography.bodySmall,
    fontWeight: "400",
    lineHeight: 18,
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 260,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
    marginTop: spacing.md,
  },
  actionBrand: {
    backgroundColor: colors.primary,
  },
  actionNeutral: {
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: "700",
  },
  actionLabelBrand: {
    color: colors.primaryForeground,
  },
  actionLabelNeutral: {
    color: colors.foreground,
  },
});
