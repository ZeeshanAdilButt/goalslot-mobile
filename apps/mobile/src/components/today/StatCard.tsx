// Summary metric tile — the mobile counterpart of dw-time-web's
// src/components/ui/stat-card.tsx (and the 4-up grid that consumes it,
// src/features/dashboard/components/dashboard-stats.tsx).
//
// Structure is deliberately identical to the web card so the two products
// read as one: micro uppercase label, an accent-tinted icon puck on the
// opposite side, then the value, then an optional sub-line. Two deliberate
// mobile deviations:
//   1. The value is much larger than web's `text-2xl` (24px). On a phone
//      these four tiles carry the whole "how is today going" answer above the
//      fold, so the number has to be the loudest thing in the tile.
//   2. Web puts the icon in a bordered ring on a flat white card; here it
//      sits in a filled tinted puck on an elevated card, because layered
//      surfaces are what keep a small screen from reading as flat paper.

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

/** Same accent vocabulary as web's `StatCardProps['accent']`, minus the variants nothing on Today uses. */
export type StatAccent = "brand" | "success" | "neutral";

export interface StatCardProps {
  label: string;
  value: string;
  /** Small supporting line under the value — web calls this `delta`. */
  detail?: string;
  icon: IconName;
  accent?: StatAccent;
  /** Rendered in place of the value; used for the loading skeleton. */
  valueSlot?: ReactNode;
}

const ACCENTS: Record<StatAccent, { puck: string; ink: string }> = {
  // Brand yellow is an accent, not a surface: the puck is the pale tint and
  // the glyph is near-black, never white-on-yellow (unreadable at 3.6:1).
  // `primaryMuted` is the brand tint; `warningMuted` (used here before) is
  // the warning tint and belongs to a different semantic.
  brand: { puck: colors.primaryMuted, ink: colors.primaryForeground },
  success: { puck: colors.successMuted, ink: colors.success },
  neutral: { puck: colors.secondary, ink: colors.mutedForeground },
};

const PUCK_SIZE = 32;

export function StatCard({ label, value, detail, icon, accent = "neutral", valueSlot }: StatCardProps) {
  const tone = ACCENTS[accent];

  return (
    // One a11y node per tile: a screen reader announcing "Planned today"
    // then "2h 30m" then "3 blocks" as three separate stops is noise, and
    // the icon is pure decoration on top of that.
    <View
      style={styles.card}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ""}`}
    >
      <View style={styles.topRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <View style={[styles.puck, { backgroundColor: tone.puck }]}>
          <Icon name={icon} size={16} color={tone.ink} />
        </View>
      </View>

      {valueSlot ?? (
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </Text>
      )}

      {detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  puck: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    // `statValue` is the semantic role foundation.ts built for exactly this
    // spot — "the big number on a stat tile" — and cites this component by
    // name. Using the token (36px) instead of a hand-rolled 30px also picks
    // up its explicit lineHeight, which is what keeps all four tiles'
    // baselines aligned across iOS/Android instead of drifting per-platform.
    ...typography.statValue,
    color: colors.foreground,
  },
  detail: {
    ...typography.bodySmall,
    fontWeight: "500",
    color: colors.mutedForeground,
  },
});
