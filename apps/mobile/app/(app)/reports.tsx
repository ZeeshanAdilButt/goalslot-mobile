// Reports tab: a deliberately small analytics view, not a port of the web
// app's multi-card recharts dashboard (see DECISIONS.md — Reports was
// deferred from v1, and the discovery notes said if it's ever built it
// should condense to a handful of stat tiles plus charts, nothing more).
// There is no reports API in `packages/shared` and this screen doesn't add
// one: everything is computed client-side by ./src/components/reports/
// aggregate.ts from data the existing query factories already expose.
//
// Concepts mirrored from dw-time-web (presentation is native, not a port):
//   - stat tiles: src/components/ui/stat-card.tsx
//   - per-day trend chart: features/reports/components/focus-trend-card.tsx
//   - time-by-category breakdown: features/reports/components/focus-category-pie-card.tsx
//   - week boundaries: packages/shared's getReportingWeekDates, the same
//     Monday-start reporting week the web app uses
//
// WHY this screen fetches its own date range instead of riding
// `timeEntryQueries.recent()` (a fixed trailing 7 days) the way it used to:
// a period selector and a "vs last week" delta both need entries the recent
// window simply doesn't contain — you cannot compare against last month
// while holding seven days. It uses the shared package's existing
// `timeEntryQueries.range` key and the existing `getByDateRange` endpoint,
// and asks for one combined window (previous period start -> current period
// end) so the comparison costs no extra request. The goal/task queries are
// untouched and still share their cache with the Goals/Tasks screens.

import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { calculateProgressPercent, formatDuration, getLocalDateString } from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton } from "@/components";
import {
  buildCategoryBreakdown,
  buildDayBuckets,
  computeTrend,
  getPeriodRanges,
  sumMinutesInRange,
  type PeriodRange,
  type ReportPeriod,
} from "@/components/reports/aggregate";
import { CategoryDonut } from "@/components/reports/CategoryDonut";
import { FocusBarChart } from "@/components/reports/FocusBarChart";
import { PeriodSelector } from "@/components/reports/PeriodSelector";
import { Reveal } from "@/components/reports/Reveal";
import { StatCard } from "@/components/reports/StatCard";
import { apiClient } from "@/lib/api-client";
import { categoryQueries, goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const CHART_BLOCK_HEIGHT = 150;
const MAX_DONUT_SIZE = 200;
/** Screen padding (spacing.xl) + card padding (spacing.lg), both sides. */
const DONUT_HORIZONTAL_INSET = 2 * spacing.xl + 2 * spacing.lg + spacing.xxl;

/** Inclusive day count for a `YYYY-MM-DD` range. Parsed from parts, never `new Date(str)` — see aggregate.ts. */
function countDays(range: PeriodRange): number {
  const toDate = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const diffMs = toDate(range.end).getTime() - toDate(range.start).getTime();
  return Math.max(1, Math.round(diffMs / 86_400_000) + 1);
}

export default function ReportsScreen() {
  const analytics = useAnalytics();
  const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [chartWidth, setChartWidth] = useState(0);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "reports" } });
    }, [analytics]),
  );

  // Recomputed per period, not per render — `getPeriodRanges` reads the wall
  // clock, and a range that silently shifts mid-render would make the charts
  // and the stat deltas disagree about where the period ends.
  const ranges = useMemo(() => getPeriodRanges(period), [period]);

  const timeEntriesQuery = useQuery({
    queryKey: timeEntryQueries.timeEntryQueries.range(ranges.fetch.start, ranges.fetch.end),
    queryFn: async () => {
      const response = await apiClient.timeEntries.getByDateRange(ranges.fetch.start, ranges.fetch.end);
      return response.data;
    },
  });
  const activeGoalsQuery = useQuery(goalQueries.list({ status: "ACTIVE" }));
  const tasksQuery = useQuery(taskQueries.list());
  const categoriesQuery = useQuery(categoryQueries.list());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        timeEntriesQuery.refetch(),
        activeGoalsQuery.refetch(),
        tasksQuery.refetch(),
        categoriesQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [activeGoalsQuery, categoriesQuery, tasksQuery, timeEntriesQuery]);

  const timeEntries = useMemo(() => timeEntriesQuery.data ?? [], [timeEntriesQuery.data]);
  const activeGoals = useMemo(() => activeGoalsQuery.data ?? [], [activeGoalsQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  const currentMinutes = useMemo(
    () => sumMinutesInRange(timeEntries, ranges.current),
    [timeEntries, ranges],
  );
  const previousMinutes = useMemo(
    () => sumMinutesInRange(timeEntries, ranges.previous),
    [timeEntries, ranges],
  );

  const buckets = useMemo(
    () => buildDayBuckets(timeEntries, ranges.current, period),
    [timeEntries, ranges, period],
  );
  const slices = useMemo(
    () => buildCategoryBreakdown(timeEntries, ranges.current, categories, colors.mutedForeground),
    [timeEntries, ranges, categories],
  );

  // Average over days that have actually happened, so a Monday doesn't show
  // a seventh of the week's real pace.
  const elapsedDays = Math.max(1, buckets.filter((bucket) => !bucket.isFuture).length);
  const currentDailyAverage = Math.round(currentMinutes / elapsedDays);
  const previousDailyAverage = Math.round(previousMinutes / countDays(ranges.previous));

  const countCompletedTasks = useCallback(
    (range: PeriodRange) =>
      tasks.filter((task) => {
        if (task.status !== "DONE" || !task.completedAt) return false;
        const key = getLocalDateString(new Date(task.completedAt));
        return key >= range.start && key <= range.end;
      }).length,
    [tasks],
  );
  const currentTasksDone = countCompletedTasks(ranges.current);
  const previousTasksDone = countCompletedTasks(ranges.previous);

  const avgGoalProgress = useMemo(() => {
    if (activeGoals.length === 0) return 0;
    const total = activeGoals.reduce(
      (sum, goal) => sum + calculateProgressPercent(goal.loggedHours, goal.targetHours),
      0,
    );
    return Math.round(total / activeGoals.length);
  }, [activeGoals]);

  const comparisonLabel = period === "week" ? "vs last week" : "vs last month";
  const donutSize = Math.min(MAX_DONUT_SIZE, Math.max(140, width - DONUT_HORIZONTAL_INSET));

  // Genuinely first load: none of the queries have cached data yet. Matches
  // the Today screen's convention — once any one of them has data (even
  // stale, from the persisted cache), fall through to real content.
  const initialLoad =
    timeEntriesQuery.isPending && activeGoalsQuery.isPending && tasksQuery.isPending;
  const initialError =
    timeEntriesQuery.isError &&
    !timeEntriesQuery.data &&
    activeGoalsQuery.isError &&
    !activeGoalsQuery.data &&
    tasksQuery.isError &&
    !tasksQuery.data;

  const hasAnyActivity = !initialLoad && (timeEntries.length > 0 || activeGoals.length > 0 || tasks.length > 0);

  if (initialLoad) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Skeleton width="30%" height={13} />
          <Skeleton width="40%" height={22} style={styles.headerSkeletonTitle} />
        </View>
        <View style={styles.sectionPadded}>
          <Skeleton width="100%" height={44} borderRadius={radii.full} />
        </View>
        <View style={styles.tileRow}>
          <Skeleton width="48%" height={104} borderRadius={radii.lg} />
          <Skeleton width="48%" height={104} borderRadius={radii.lg} />
        </View>
        <View style={styles.sectionPadded}>
          <Skeleton width="100%" height={CHART_BLOCK_HEIGHT + spacing.xxxl} borderRadius={radii.lg} />
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            accessibilityLabel="Pull to refresh reports"
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Analytics</Text>
          <Text style={styles.headerTitle}>Reports</Text>
        </View>

        {!hasAnyActivity ? (
          <EmptyState
            message="Nothing to report yet"
            description="Track a focus session, add a goal or finish a task — your trends will build up here."
            actionLabel="Open the timer"
            onAction={() => router.push("/timer")}
          />
        ) : (
          <>
            <View style={styles.sectionPadded}>
              <PeriodSelector value={period} onChange={setPeriod} />
              <Text style={styles.rangeLabel}>{ranges.label}</Text>
            </View>

            <Reveal style={styles.tileRow}>
              <StatCard
                label="Focus time"
                value={formatDuration(currentMinutes)}
                trend={computeTrend(currentMinutes, previousMinutes)}
                comparisonLabel={comparisonLabel}
              />
              <StatCard
                label="Daily average"
                value={formatDuration(currentDailyAverage)}
                trend={computeTrend(currentDailyAverage, previousDailyAverage)}
                comparisonLabel={comparisonLabel}
              />
            </Reveal>

            <Reveal delay={70} style={styles.tileRow}>
              <StatCard
                label="Tasks done"
                value={String(currentTasksDone)}
                trend={computeTrend(currentTasksDone, previousTasksDone)}
                comparisonLabel={comparisonLabel}
              />
              <StatCard
                label="Active goals"
                value={String(activeGoals.length)}
                sublabel={activeGoals.length > 0 ? `${avgGoalProgress}% avg progress` : "None yet"}
              />
            </Reveal>

            <Reveal delay={140} style={styles.section}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Focus per day</Text>
                  <Text style={styles.cardTotal}>{formatDuration(currentMinutes)}</Text>
                </View>
                <View
                  style={styles.chartArea}
                  onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
                  accessible
                  accessibilityLabel={buildChartSummary(currentMinutes, buckets.length, period)}
                >
                  {currentMinutes === 0 ? (
                    <Text style={styles.emptyChartText}>
                      Nothing logged {period === "week" ? "this week" : "this month"} yet.
                    </Text>
                  ) : (
                    <FocusBarChart buckets={buckets} width={chartWidth} labelEvery={period === "week" ? 1 : 7} />
                  )}
                </View>
              </View>
            </Reveal>

            <Reveal delay={210} style={styles.section}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Time by category</Text>
                  <Text style={styles.cardTotal}>{slices.length > 0 ? `${slices.length} in play` : ""}</Text>
                </View>
                {slices.length === 0 ? (
                  <Text style={styles.emptyChartText}>
                    Categories show up once your logged time is attached to a goal.
                  </Text>
                ) : (
                  <CategoryDonut slices={slices} size={donutSize} />
                )}
              </View>
            </Reveal>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One spoken sentence instead of 31 individually-focusable bars. */
function buildChartSummary(minutes: number, dayCount: number, period: ReportPeriod): string {
  return `Bar chart of focus time per day. ${formatDuration(minutes)} logged across ${dayCount} days ${
    period === "week" ? "this week" : "this month"
  }.`;
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
  sectionPadded: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  rangeLabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  tileRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.label,
    color: colors.foreground,
  },
  cardTotal: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.mutedForeground,
  },
  chartArea: {
    width: "100%",
  },
  emptyChartText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    textAlign: "center",
    paddingVertical: spacing.xxl,
  },
});
