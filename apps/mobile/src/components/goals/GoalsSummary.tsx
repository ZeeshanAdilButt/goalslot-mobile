// The three-number strip above the goal list.
//
// Mirrors dw-time-web/src/features/goals/components/goals-stats.tsx, which
// dedicates a full row of StatCards to the numbers worth knowing before you
// read any individual goal. On a phone it scrolls away with the list rather
// than permanently eating vertical space, and each tile gains the third
// `detail` line that src/components/today/StatCard.tsx established — which is
// where the target-hours denominator now lives. The previous version summed
// the targets and then never rendered them, so "Logged 12.5h" was a numerator
// with no denominator sitting next to a number that had already been
// computed.
//
// SUMMARY_HEIGHT is exported so the loading skeleton can reserve exactly this
// much room; without it the whole list stepped down by ~76pt the moment the
// real strip appeared.

import { StyleSheet, Text, View } from "react-native";

import { calculateProgressPercent, type Goal } from "@goalslot/shared";

import { colors, radii, spacing, typography } from "@/theme/tokens";

/** Height the strip settles at — three lines of type plus its own padding. */
export const SUMMARY_HEIGHT = 76;

export interface GoalsSummaryData {
  count: number;
  logged: number;
  target: number;
  averageProgress: number;
}

/**
 * Returns null for an empty list — there is no summary of nothing, and the
 * empty state below owns that moment instead.
 */
export function summariseGoals(goals: Goal[] | undefined): GoalsSummaryData | null {
  if (!goals || goals.length === 0) return null;

  let logged = 0;
  let target = 0;
  let progressTotal = 0;

  for (const goal of goals) {
    if (Number.isFinite(goal.loggedHours)) logged += goal.loggedHours;
    if (Number.isFinite(goal.targetHours)) target += goal.targetHours;
    // `calculateProgressPercent` clamps the TOP of the range only
    // (packages/shared/src/scheduling/progress.ts:14 is `Math.min(100, ...)`),
    // so a record with negative logged hours would drag the average below
    // zero and print "-4%". ProgressRing clamps for its own display; this
    // average had nothing doing the same job.
    progressTotal += Math.max(0, calculateProgressPercent(goal.loggedHours, goal.targetHours));
  }

  return {
    count: goals.length,
    logged,
    target,
    averageProgress: Math.round(progressTotal / goals.length),
  };
}

export interface GoalsSummaryProps {
  data: GoalsSummaryData;
  /** Lower-case name of the tab being summarised, e.g. "active". */
  statusLabel: string;
}

export function GoalsSummary({ data, statusLabel }: GoalsSummaryProps) {
  return (
    <View style={styles.row}>
      <SummaryStat
        value={String(data.count)}
        label={data.count === 1 ? "Goal" : "Goals"}
        detail={statusLabel}
      />
      <View style={styles.divider} />
      <SummaryStat
        value={`${data.logged.toFixed(1)}h`}
        label="Logged"
        detail={data.target > 0 ? `of ${formatTarget(data.target)}` : "no target set"}
      />
      <View style={styles.divider} />
      <SummaryStat value={`${data.averageProgress}%`} label="Avg" detail="complete" accent />
    </View>
  );
}

function formatTarget(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}h`;
}

function SummaryStat({
  value,
  label,
  detail,
  accent,
}: {
  value: string;
  label: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    // Grouped into one focus stop: as three sibling Texts this announced
    // "3", "Goals", "active" as three separate swipes with no relationship
    // between them.
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}, ${detail}`}>
      <Text style={[styles.value, accent && styles.valueAccent]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.detail} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: SUMMARY_HEIGHT,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xxs,
  },
  value: {
    ...typography.title,
    color: colors.foreground,
  },
  valueAccent: {
    color: colors.primaryDark,
  },
  label: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  detail: {
    ...typography.label,
    fontWeight: "400",
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForegroundLight,
  },
  divider: {
    width: 1,
    height: 34,
    backgroundColor: colors.border,
  },
});
