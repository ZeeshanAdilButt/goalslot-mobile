// Full-screen empty state for the list tabs.
//
// The web's empty states are a lucide glyph, a title and a description inside
// a GlassCard (dw-time-web/src/components/ui/empty-state.tsx, wired up in
// features/goals/components/goals-list.tsx:32-54 and
// features/tasks/components/task-list.tsx:34-42). A single small glyph works
// inside a dashboard column; alone on a phone screen it reads as a loading
// failure. So the copy structure is kept verbatim — headline, supporting
// line, one primary action — and the glyph is replaced with a drawn preview
// of the list that WOULD be there: ghost rows plus the one detail that
// distinguishes this screen (a progress dial for goals, checkboxes for
// tasks, color swatches for categories, an indent tree for notes).
//
// Drawn with react-native-svg (already a dependency, used by
// src/components/brand/GoalSlotLogo.tsx) from theme tokens only — the brand
// yellow appears exactly once per illustration, on the element the CTA is
// about to create.

import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { withAlpha } from "./color";

export type EmptyIllustrationVariant = "goals" | "tasks" | "categories" | "notes";

const ILLUSTRATION_W = 208;
const ILLUSTRATION_H = 140;

/** Ghost row geometry, shared by every variant so the four screens rhyme. */
const ROW_Y = [46, 72, 98];
const ROW_H = 11;

function GhostRows({ startX, widths }: { startX: number[]; widths: number[] }) {
  return (
    <>
      {ROW_Y.map((y, i) => (
        <Rect
          key={y}
          x={startX[i]}
          y={y - ROW_H / 2}
          width={widths[i]}
          height={ROW_H}
          rx={ROW_H / 2}
          fill={colors.secondary}
        />
      ))}
    </>
  );
}

function EmptyIllustration({ variant }: { variant: EmptyIllustrationVariant }) {
  const panel = (
    <>
      <Rect
        x={10}
        y={12}
        width={ILLUSTRATION_W - 20}
        height={ILLUSTRATION_H - 24}
        rx={radii.xl}
        fill={colors.card}
        stroke={colors.border}
        strokeWidth={1.5}
      />
      <Rect x={26} y={26} width={54} height={7} rx={3.5} fill={withAlpha(colors.primary, 0.35, colors.secondary)} />
    </>
  );

  if (variant === "goals") {
    // A 3/4-swept dial, the same object the real goal rows lead with.
    const cx = 150;
    const cy = 74;
    const r = 26;
    const circumference = 2 * Math.PI * r;
    return (
      <Svg width={ILLUSTRATION_W} height={ILLUSTRATION_H} viewBox={`0 0 ${ILLUSTRATION_W} ${ILLUSTRATION_H}`}>
        {panel}
        <GhostRows startX={[26, 26, 26]} widths={[70, 52, 40]} />
        <Circle cx={cx} cy={cy} r={r} stroke={colors.secondary} strokeWidth={7} fill="none" />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={colors.primary}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.35}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
    );
  }

  if (variant === "tasks") {
    return (
      <Svg width={ILLUSTRATION_W} height={ILLUSTRATION_H} viewBox={`0 0 ${ILLUSTRATION_W} ${ILLUSTRATION_H}`}>
        {panel}
        <GhostRows startX={[54, 54, 54]} widths={[112, 84, 64]} />
        {ROW_Y.map((y, i) => (
          <Rect
            key={y}
            x={26}
            y={y - 9}
            width={18}
            height={18}
            rx={6}
            fill={i === 0 ? colors.success : colors.card}
            stroke={i === 0 ? colors.success : colors.border}
            strokeWidth={2}
          />
        ))}
        <Path
          d="M30.5 46.5 L34 50 L39.5 43"
          stroke={colors.successForeground}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    );
  }

  if (variant === "categories") {
    const swatches = [colors.primary, colors.success, colors.warning];
    return (
      <Svg width={ILLUSTRATION_W} height={ILLUSTRATION_H} viewBox={`0 0 ${ILLUSTRATION_W} ${ILLUSTRATION_H}`}>
        {panel}
        <GhostRows startX={[58, 58, 58]} widths={[104, 78, 92]} />
        {ROW_Y.map((y, i) => (
          <Circle key={y} cx={38} cy={y} r={11} fill={withAlpha(swatches[i], 0.18, colors.secondary)} />
        ))}
        {ROW_Y.map((y, i) => (
          <Circle key={`dot-${y}`} cx={38} cy={y} r={5.5} fill={swatches[i]} />
        ))}
      </Svg>
    );
  }

  // notes — indentation IS the model here (OneNote-style subpages), so the
  // ghost rows step right and a connector traces the hierarchy.
  return (
    <Svg width={ILLUSTRATION_W} height={ILLUSTRATION_H} viewBox={`0 0 ${ILLUSTRATION_W} ${ILLUSTRATION_H}`}>
      {panel}
      <GhostRows startX={[44, 62, 62]} widths={[118, 92, 74]} />
      <Path
        d="M34 46 L34 98"
        stroke={colors.border}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M52 72 L52 98" stroke={colors.border} strokeWidth={1.5} strokeLinecap="round" fill="none" />
      <Path
        d="M28 42 L34 46.5 L28 51"
        stroke={colors.primary}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export interface ListEmptyStateProps {
  variant: EmptyIllustrationVariant;
  /** Headline — web's EmptyState `title`. */
  title: string;
  /** Supporting line — web's EmptyState `description`. */
  description?: string;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  /** Small dismissible-tone hint under the CTA, e.g. a gesture tip. */
  hint?: string;
  /**
   * For empty states that sit INSIDE a section of a scrolling page (the
   * Categories screen has two) rather than owning the whole screen: drops the
   * flex fill so the block sizes to its content, and trims the vertical air
   * that only makes sense when it's the single thing on screen.
   */
  compact?: boolean;
}

export function ListEmptyState({
  variant,
  title,
  description,
  actionLabel,
  actionIcon = "add",
  onAction,
  hint,
  compact = false,
}: ListEmptyStateProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <EmptyIllustration variant={variant} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}

      {actionLabel && onAction ? (
        <TouchableOpacity
          style={styles.action}
          onPress={onAction}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Icon name={actionIcon} size={18} color={colors.primaryForeground} />
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    gap: spacing.sm,
  },
  containerCompact: {
    flex: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    fontSize: 20,
    color: colors.foreground,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  description: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    marginTop: spacing.md,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: "700",
    // Dark text on brand yellow, never white.
    color: colors.primaryForeground,
  },
  hint: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    textAlign: "center",
    marginTop: spacing.xs,
    maxWidth: 280,
  },
});
