// Reports tab: a deliberately small stats view, not a port of the web app's
// multi-card recharts dashboard (see DECISIONS.md — Reports was deferred
// from v1, and the discovery notes said if it's ever built it should
// condense to 2-3 stat tiles + one trend chart, nothing more). There is no
// reports API on `packages/shared` (and this screen intentionally doesn't
// add one) — everything here is computed client-side from data the app
// already fetches via the existing goal/task/time-entry query factories.

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

const TREND_DAYS = 7;
const CHART_HEIGHT = 96;
const MIN_BAR_HEIGHT = 3;

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
          <Skeleton width="40%" height={22} />
        </View>
        <View style={styles.tileRow}>
          <Skeleton width="30%" height={84} borderRadius={12} />
          <Skeleton width="30%" height={84} borderRadius={12} />
          <Skeleton width="30%" height={84} borderRadius={12} />
        </View>
        <View style={styles.section}>
          <Skeleton width="50%" height={14} />
          <Skeleton width="100%" height={CHART_HEIGHT + 24} style={styles.chartSkeleton} />
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
          <Text style={styles.headerTitle}>Reports</Text>
        </View>

        {noData ? (
          <EmptyState message="No activity yet — track time, add goals, or complete tasks to see your stats here." />
        ) : (
          <>
            <View style={styles.tileRow}>
              <StatTile label="Hours this week" value={formatDuration(minutesThisWeek)} />
              <StatTile
                label="Active goals"
                value={String(activeGoals.length)}
                sublabel={activeGoals.length > 0 ? `${avgGoalProgress}% avg progress` : undefined}
              />
              <StatTile label="Tasks done this week" value={String(tasksCompletedThisWeek)} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Hours logged — last 7 days</Text>
              <View style={styles.chart}>
                {dailyTotals.map((day) => {
                  const barHeight: DimensionValue =
                    day.minutes === 0 ? 0 : Math.max(MIN_BAR_HEIGHT, Math.round((day.minutes / maxMinutes) * CHART_HEIGHT));
                  return (
                    <View
                      key={day.dateStr}
                      style={styles.chartColumn}
                      accessible
                      accessibilityLabel={`${day.label}: ${formatDuration(day.minutes)} logged`}
                    >
                      <View style={styles.barTrack}>
                        <View style={[styles.bar, { height: barHeight }]} />
                      </View>
                      <Text style={styles.barLabel}>{day.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
}

function StatTile({ label, value, sublabel }: StatTileProps) {
  return (
    <View
      style={styles.tile}
      accessible
      accessibilityLabel={`${label}: ${value}${sublabel ? `, ${sublabel}` : ""}`}
    >
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
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
    backgroundColor: "#FFFFFF",
  },
  scrollContent: {
    paddingBottom: 96,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0F172A",
  },
  tileRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  tile: {
    flex: 1,
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
  },
  tileValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1F2933",
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  tileSublabel: {
    fontSize: 11,
    color: "#94A3B8",
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    opacity: 0.5,
  },
  chartSkeleton: {
    marginTop: 4,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: CHART_HEIGHT + 24,
  },
  chartColumn: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  barTrack: {
    width: "60%",
    height: CHART_HEIGHT,
    justifyContent: "flex-end",
  },
  bar: {
    width: "100%",
    borderRadius: 4,
    backgroundColor: "#1F2933",
    minHeight: 0,
  },
  barLabel: {
    fontSize: 11,
    color: "#64748B",
  },
});
