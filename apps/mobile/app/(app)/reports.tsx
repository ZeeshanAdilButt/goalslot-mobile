// Reports tab: a deliberately small stats view, not a port of the web app's
// multi-card recharts dashboard (see DECISIONS.md — Reports was deferred
// from v1, and the discovery notes said if it's ever built it should
// condense to 2-3 stat tiles + one trend chart, nothing more). There is no
// reports API on `packages/shared` (and this screen intentionally doesn't
// add one) — everything here is computed client-side from data the app
// already fetches via the existing goal/task/time-entry query factories.
//
// Visual language borrows dw-time-web's reports/time-tracker cards (see
// dw-time-web/src/components/ui/stat-card.tsx and
// dw-time-web/src/features/reports/components/focus-trend-card.tsx):
// bordered white cards, an uppercase caption + tabular bold value per tile,
// and a chart with a baseline, light gridlines and a brand-colored series —
// no charting library is added here, this is the same View-based bar chart
// dressed to read like a real one.

import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  calculateProgressPercent,
  DAYS_OF_WEEK,
  formatDuration,
  getLocalDateString,
  getReportingWeekDates,
  type TimeEntry,
} from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton } from "@/components";
import { goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const TREND_DAYS = 7;
const CHART_HEIGHT = 96;
const MIN_BAR_HEIGHT = 3;
const CHART_LABEL_ROW_HEIGHT = 24;
// 0 doubles as the baseline/x-axis line sitting right under the bars.
const GRIDLINE_FRACTIONS = [0, 0.25, 0.5, 0.75];

type StatAccent = "brand" | "success" | "neutral";

const ACCENT_COLOR: Record<StatAccent, string> = {
  brand: colors.primary,
  success: colors.success,
  neutral: colors.mutedForeground,
};

interface DailyTotal {
  dateStr: string;
  label: string;
  minutes: number;
}

// Builds the trailing 7-day (today inclusive) bucket list for the trend
// chart. `timeEntryQueries.recent()` already fetches exactly this window
// (see packages/shared/src/queries/time-entries.ts), so this just buckets
// what was already fetched — no extra request.
function buildDailyTotals(entries: TimeEntry[]): DailyTotal[] {
  const today = new Date();
  const days: DailyTotal[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ dateStr: getLocalDateString(d), label: DAYS_OF_WEEK[d.getDay()], minutes: 0 });
  }

  const byDate = new Map(days.map((day) => [day.dateStr, day]));
  for (const entry of entries) {
    const bucket = byDate.get(entry.date.slice(0, 10));
    if (bucket) bucket.minutes += entry.duration;
  }
  return days;
}

export default function ReportsScreen() {
  const analytics = useAnalytics();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "reports" } });
    }, [analytics]),
  );

  // `timeEntryQueries.recent()` (rolling last 7 days) and `goalQueries.list({status:"ACTIVE"})` /
  // `taskQueries.list()` (no filters) are the same query keys the Goals/Tasks
  // screens already use — this screen rides their cache instead of issuing
  // fresh requests when it's not the first screen visited.
  const timeEntriesQuery = useQuery(timeEntryQueries.recent());
  const activeGoalsQuery = useQuery(goalQueries.list({ status: "ACTIVE" }));
  const tasksQuery = useQuery(taskQueries.list());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([timeEntriesQuery.refetch(), activeGoalsQuery.refetch(), tasksQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [activeGoalsQuery, tasksQuery, timeEntriesQuery]);

  // `getReportingWeekDates` is the shared package's canonical Monday-start
  // "this week" helper (packages/shared/src/scheduling/reporting.ts) — reused
  // here instead of hand-rolling week-boundary math. A "this week so far"
  // range is always fully inside a trailing-7-day window ending today, so
  // filtering the `recent()` data down to this week's day-keys is safe: it
  // never needs entries outside what was already fetched.
  const weekDaySet = useMemo(() => {
    const { days } = getReportingWeekDates();
    return new Set(days.map((d) => getLocalDateString(d)));
  }, []);

  const timeEntries = timeEntriesQuery.data ?? [];
  const activeGoals = activeGoalsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];

  const minutesThisWeek = useMemo(
    () =>
      timeEntries
        .filter((entry) => weekDaySet.has(entry.date.slice(0, 10)))
        .reduce((sum, entry) => sum + entry.duration, 0),
    [timeEntries, weekDaySet],
  );

  const avgGoalProgress = useMemo(() => {
    if (activeGoals.length === 0) return 0;
    const total = activeGoals.reduce(
      (sum, goal) => sum + calculateProgressPercent(goal.loggedHours, goal.targetHours),
      0,
    );
    return Math.round(total / activeGoals.length);
  }, [activeGoals]);

  const tasksCompletedThisWeek = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === "DONE" &&
          !!task.completedAt &&
          weekDaySet.has(getLocalDateString(new Date(task.completedAt))),
      ).length,
    [tasks, weekDaySet],
  );

  const dailyTotals = useMemo(() => buildDailyTotals(timeEntries), [timeEntries]);
  const maxMinutes = Math.max(1, ...dailyTotals.map((day) => day.minutes));
  const totalTrailingMinutes = useMemo(
    () => dailyTotals.reduce((sum, day) => sum + day.minutes, 0),
    [dailyTotals],
  );
  const todayDateStr = useMemo(() => getLocalDateString(), []);

  // Genuinely first load: none of the three queries have cached data yet.
  // Matches the Today screen's convention — once any one of them has data
  // (even stale, from the persisted cache), fall through to real content.
  const initialLoad = timeEntriesQuery.isPending && activeGoalsQuery.isPending && tasksQuery.isPending;
  const initialError =
    timeEntriesQuery.isError &&
    !timeEntriesQuery.data &&
    activeGoalsQuery.isError &&
    !activeGoalsQuery.data &&
    tasksQuery.isError &&
    !tasksQuery.data;

  const noData = !initialLoad && timeEntries.length === 0 && activeGoals.length === 0 && tasks.length === 0;

  if (initialLoad) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Skeleton width="30%" height={13} />
          <Skeleton width="40%" height={22} style={styles.headerSkeletonTitle} />
        </View>
        <View style={styles.tileRow}>
          <Skeleton width="30%" height={84} borderRadius={radii.lg} />
          <Skeleton width="30%" height={84} borderRadius={radii.lg} />
          <Skeleton width="30%" height={84} borderRadius={radii.lg} />
        </View>
        <View style={styles.section}>
          <Skeleton width="50%" height={14} />
          <Skeleton width="100%" height={CHART_HEIGHT + CHART_LABEL_ROW_HEIGHT} style={styles.chartSkeleton} />
        </View>
      </SafeAreaView>
    );
  }

  if (initialError) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ErrorState
          message="Couldn't load your reports."
          onRetry={() => {
            void timeEntriesQuery.refetch();
            void activeGoalsQuery.refetch();
            void tasksQuery.refetch();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} accessibilityLabel="Pull to refresh reports" />
        }
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Analytics</Text>
          <Text style={styles.headerTitle}>Reports</Text>
        </View>

        {noData ? (
          <EmptyState message="No activity yet — track time, add goals, or complete tasks to see your stats here." />
        ) : (
          <>
            <View style={styles.tileRow}>
              <StatCard label="Hours this week" value={formatDuration(minutesThisWeek)} accent="brand" />
              <StatCard
                label="Active goals"
                value={String(activeGoals.length)}
                sublabel={activeGoals.length > 0 ? `${avgGoalProgress}% avg progress` : undefined}
                accent="neutral"
              />
              <StatCard label="Tasks done this week" value={String(tasksCompletedThisWeek)} accent="success" />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Hours logged — last 7 days</Text>
                <Text style={styles.sectionTotal}>{formatDuration(totalTrailingMinutes)}</Text>
              </View>

              <View style={styles.chartCard}>
                <View style={styles.chart}>
                  {/* Gridlines behind the bars give the chart a baseline/axis
                      reading instead of bars floating in empty space —
                      mirrors the CartesianGrid in dw-time-web's
                      FocusTrendCard (recharts isn't available here). */}
                  <View style={styles.gridlines} pointerEvents="none">
                    {GRIDLINE_FRACTIONS.map((fraction) => (
                      <View
                        key={fraction}
                        style={[
                          styles.gridline,
                          fraction === 0 && styles.gridlineBaseline,
                          { bottom: CHART_LABEL_ROW_HEIGHT + CHART_HEIGHT * fraction },
                        ]}
                      />
                    ))}
                  </View>

                  {dailyTotals.map((day) => {
                    const isToday = day.dateStr === todayDateStr;
                    const barHeight: DimensionValue =
                      day.minutes === 0
                        ? MIN_BAR_HEIGHT
                        : Math.max(MIN_BAR_HEIGHT, Math.round((day.minutes / maxMinutes) * CHART_HEIGHT));
                    return (
                      <View
                        key={day.dateStr}
                        style={styles.chartColumn}
                        accessible
                        accessibilityLabel={`${day.label}: ${formatDuration(day.minutes)} logged`}
                      >
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.bar,
                              { height: barHeight },
                              day.minutes === 0 ? styles.barEmpty : isToday && styles.barToday,
                            ]}
                          />
                        </View>
                        <Text style={[styles.barLabel, isToday && styles.barLabelToday]}>{day.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  accent: StatAccent;
}

// Mirrors dw-time-web's <StatCard>: uppercase caption + accent dot up top,
// a big bold tabular-figure value, and an optional muted sublabel — a
// "designed" tile instead of a flat colored box.
function StatCard({ label, value, sublabel, accent }: StatCardProps) {
  return (
    <View
      style={styles.tile}
      accessible
      accessibilityLabel={`${label}: ${value}${sublabel ? `, ${sublabel}` : ""}`}
    >
      <View style={styles.tileHeaderRow}>
        <Text style={styles.tileLabel} numberOfLines={2}>
          {label}
        </Text>
        <View style={[styles.tileAccentDot, { backgroundColor: ACCENT_COLOR[accent] }]} />
      </View>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      {sublabel ? (
        <Text style={styles.tileSublabel} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 96,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  eyebrow: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
  },
  headerSkeletonTitle: {
    marginTop: spacing.xxs,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.foreground,
  },
  tileRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  tile: {
    flex: 1,
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  tileHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  tileAccentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 2,
  },
  tileValue: {
    fontSize: 20,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: colors.foreground,
  },
  tileLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.mutedForeground,
  },
  tileSublabel: {
    fontSize: 11,
    color: colors.mutedForeground,
  },
  section: {
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  sectionTitle: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  sectionTotal: {
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: colors.foreground,
  },
  chartSkeleton: {
    marginTop: 4,
  },
  chartCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: CHART_HEIGHT + CHART_LABEL_ROW_HEIGHT,
  },
  gridlines: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridline: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  gridlineBaseline: {
    opacity: 1,
  },
  chartColumn: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
  },
  barTrack: {
    width: "60%",
    height: CHART_HEIGHT,
    justifyContent: "flex-end",
  },
  bar: {
    width: "100%",
    borderTopLeftRadius: radii.sm,
    borderTopRightRadius: radii.sm,
    backgroundColor: colors.primary,
    minHeight: MIN_BAR_HEIGHT,
  },
  barEmpty: {
    backgroundColor: colors.border,
  },
  barToday: {
    backgroundColor: colors.primaryDark,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  barLabelToday: {
    fontWeight: "700",
    color: colors.foreground,
  },
});
