// A single summary tile: tiny uppercase label, one large tabular number,
// and a period-over-period delta chip.
//
// Follows dw-time-web's <StatCard> (dw-time-web/src/components/ui/stat-card.tsx)
// — `text-[10px] font-semibold uppercase tracking-wider` caption over a big
// bold value — but adds the delta chip, which the web card doesn't have. A
// number with nothing to compare it against ("6h 30m") is trivia; the same
// number next to "▲ 18% vs last week" is a report.
//
// Up is always the good direction for every metric this screen shows (more
// focus logged, more tasks finished), so up maps to the success token and
// down to destructive without any per-metric configuration.

import { StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import type { Trend, TrendDirection } from "@/components/reports/aggregate";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

/** Above this the delta chip shows ">999%" instead of the literal figure. */
const MAX_TREND_PERCENT = 999;

const TREND_TONE: Record<TrendDirection, { foreground: string; background: string }> = {
  up: { foreground: colors.success, background: colors.successMuted },
  down: { foreground: colors.destructive, background: colors.destructiveMuted },
  flat: { foreground: colors.mutedForeground, background: colors.secondary },
  // Dark text on brand yellow — never white, the contrast fails.
  new: { foreground: colors.primaryForeground, background: colors.primary },
};

function TrendGlyph({ direction, color }: { direction: TrendDirection; color: string }) {
  if (direction === "flat") {
    return (
      <Svg width={10} height={10} viewBox="0 0 12 12">
        <Rect x="1.5" y="5" width="9" height="2" rx="1" fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={10} height={10} viewBox="0 0 12 12">
      <Path d={direction === "down" ? "M6 10 L1 3.5 L11 3.5 Z" : "M6 2 L11 8.5 L1 8.5 Z"} fill={color} />
    </Svg>
  );
}

export interface StatCardProps {
  label: string;
  /** Pre-formatted — durations should already be through `formatDuration`. */
  value: string;
  sublabel?: string;
  trend?: Trend;
  /** What the delta is measured against, e.g. "vs last week". */
  comparisonLabel?: string;
}

export function StatCard({ label, value, sublabel, trend, comparisonLabel }: StatCardProps) {
  const tone = trend ? TREND_TONE[trend.direction] : null;
  const trendText = trend
    ? trend.direction === "new"
      ? "New"
      : trend.direction === "flat"
        ? "No change"
        : // Clamped, because `computeTrend` divides by the previous period and
          // small denominators are routine: two minutes last week against two
          // hours this week is a literal 5900%, which is both meaningless and
          // wide enough to push the chip past the tile's edge on a half-width
          // card. Past this point the only readable statement is "a lot more".
          `${trend.percent > MAX_TREND_PERCENT ? `>${MAX_TREND_PERCENT}` : trend.percent}%`
    : null;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={[
        `${label}: ${value}`,
        sublabel,
        trendText && comparisonLabel ? `${trendText} ${comparisonLabel}` : trendText,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>

      {trend && tone && trendText ? (
        <View style={styles.footer}>
          <View style={[styles.trendChip, { backgroundColor: tone.background }]}>
            <TrendGlyph direction={trend.direction} color={tone.foreground} />
            <Text style={[styles.trendText, { color: tone.foreground }]}>{trendText}</Text>
          </View>
          {comparisonLabel ? (
            <Text style={styles.comparison} numberOfLines={1}>
              {comparisonLabel}
            </Text>
          ) : null}
        </View>
      ) : sublabel ? (
        <Text style={styles.comparison} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  label: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  value: {
    fontSize: 28,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.8,
    color: colors.foreground,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  trendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
  },
  trendText: {
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  comparison: {
    fontSize: 11,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
});
