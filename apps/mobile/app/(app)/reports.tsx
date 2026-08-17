// Reports tab: a deliberately small analytics view, computed client-side by
// ./src/components/reports/aggregate.ts — there is no reports API.
//
// Fetches its own date range rather than riding `timeEntryQueries.recent()`
// (a fixed trailing 7 days): a period selector and a "vs last week" delta
// both need entries that fixed window doesn't contain. It asks for one
// combined window (previous period start -> current period end) so the
// comparison costs no extra request.

import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { calculateProgressPercent, formatDuration, getLocalDateString } from "@goalslot/shared";

import { EmptyState, QueryErrorState, Skeleton } from "@/components";
import { HiddenTabBackButton, useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";
import {
  buildCategoryBreakdown,
  buildDayBuckets,
  buildDayGoalBreakdown,
  buildGoalBreakdown,
  buildTaskBreakdown,
  computeTrend,
  getPeriodRanges,
  sumMinutesInRange,
  UNCATEGORIZED_KEY,
  type PeriodRange,
  type ReportPeriod,
} from "@/components/reports/aggregate";
import { CategoryDonut } from "@/components/reports/CategoryDonut";
import { FocusBarChart } from "@/components/reports/FocusBarChart";
import { PeriodSelector } from "@/components/reports/PeriodSelector";
import { Reveal } from "@/components/reports/Reveal";
import { StatCard } from "@/components/reports/StatCard";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient } from "@/lib/api-client";
import { categoryQueries, goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const CHART_BLOCK_HEIGHT = 150;
const MAX_DONUT_SIZE = 200;
/**
 * Gutter kept clear for the floating menu button app/(app)/_layout.tsx pins
 * top-right over every screen. Same 64pt index.tsx and schedule.tsx use.
 */
const HAMBURGER_CLEARANCE = 64;
// Screen padding (spacing.xl) + card padding (spacing.xxl — see `card` in
// the stylesheet below), both sides, plus a buffer term. Keep this in step
// with `styles.card.padding`: if that padding changes and this doesn't, the
// donut is sized for a card wider than the one it actually renders inside.
const DONUT_HORIZONTAL_INSET = 2 * spacing.xl + 2 * spacing.xxl + spacing.xxl;

/** Parsed from parts, never `new Date(str)` — see aggregate.ts's header for why. */
function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Inclusive day count for a `YYYY-MM-DD` range. */
function countDays(range: PeriodRange): number {
  const diffMs = parseDateKey(range.end).getTime() - parseDateKey(range.start).getTime();
  return Math.max(1, Math.round(diffMs / 86_400_000) + 1);
}

/** Heading for the tapped-day drill-down, e.g. "Today" or "Wednesday, 12 Aug". */
function formatDayHeading(dateKey: string): string {
  if (dateKey === getLocalDateString()) return "Today";
  return parseDateKey(dateKey).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export default function ReportsScreen() {
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [chartWidth, setChartWidth] = useState(0);
  // `dateKey` of the bar the user drilled into, or null when the "Focus per
  // day" chart is showing only the aggregate. Not cleared on period switch —
  // if it's still a real bar in the new `buckets` (e.g. flipping week ->
  // month -> week lands back on the same days) the drill-down just keeps
  // showing; `selectedBucket` below is what actually gates the UI, so a
  // dateKey that doesn't exist in the new period's buckets silently hides it.
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  // Key of the goal drilled into on the "Time by goal" card, or null. Same
  // "not cleared on period switch" contract as `selectedDayKey` above —
  // `selectedGoalSlice` below is what actually gates the UI, so a goalId
  // that no longer has time in the new period's `goalSlices` silently hides
  // the task drill-down rather than needing an explicit reset here.
  const [selectedGoalKey, setSelectedGoalKey] = useState<string | null>(null);

  // The wall-clock instant every period boundary is measured from. Held in
  // state rather than read inline because `getPeriodRanges` and
  // `buildDayBuckets` must agree on where "today" is within a single render —
  // and because memoising the ranges on `period` alone (what this did before)
  // froze them at mount: an app left open past midnight kept highlighting
  // yesterday's bar as today, and one left open past Sunday night went on
  // charting the previous reporting week indefinitely.
  const [periodAnchor, setPeriodAnchor] = useState(() => new Date());

  useScreenView("reports");

  useFocusEffect(
    useCallback(() => {
      // Re-anchor only when the calendar day has actually turned over.
      // Replacing it on every focus would churn the query key (it feeds
      // `ranges.fetch`) and refetch for nothing.
      setPeriodAnchor((previous) =>
        getLocalDateString(previous) === getLocalDateString() ? previous : new Date(),
      );
    }, []),
  );

  // This route is a hidden Tabs.Screen (see app/(app)/_layout.tsx), not a
  // pushed stack entry, so the OS back gesture/button doesn't reliably return
  // to Settings — it was landing on the Today dashboard instead. Same fix
  // note/[id].tsx and notification-settings.tsx already use for the identical
  // problem. Settings is the documented, deliberate way to reach this screen;
  // it's also reachable from Today's "Jump back in" grid, the drawer and
  // global search, which this can't distinguish from here — accepted
  // limitation of a single-destination fix rather than a full
  // navigation-stack rework.
  useHiddenTabBackHandler(hiddenTabBackDestination("reports"));

  const ranges = useMemo(() => getPeriodRanges(period, periodAnchor), [period, periodAnchor]);

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

  const onRefresh = useCallback(() => {
    void timeEntriesQuery.refetch();
    void activeGoalsQuery.refetch();
    void tasksQuery.refetch();
    void categoriesQuery.refetch();
  }, [activeGoalsQuery, categoriesQuery, tasksQuery, timeEntriesQuery]);

  // Derived from the queries rather than a local boolean the handler flips.
  // A local flag only ever knows about refetches *this* handler started, so a
  // refetch kicked off anywhere else — the timer screen invalidating
  // `time-entries` after a session is logged, a reconnect — updated the
  // numbers under the user with no indication anything had happened. The
  // `!isPending` half keeps the spinner off a genuine first load, which is
  // the skeleton's job.
  const isRefreshing =
    (timeEntriesQuery.isFetching && !timeEntriesQuery.isPending) ||
    (activeGoalsQuery.isFetching && !activeGoalsQuery.isPending) ||
    (tasksQuery.isFetching && !tasksQuery.isPending) ||
    (categoriesQuery.isFetching && !categoriesQuery.isPending);

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

  // Only a real bar in the *current* buckets counts as selected — see the
  // state comment above for why a stale dateKey from a different period
  // isn't cleared explicitly.
  const selectedBucket = useMemo(
    () => buckets.find((bucket) => bucket.dateKey === selectedDayKey) ?? null,
    [buckets, selectedDayKey],
  );
  const daySlices = useMemo(
    () => (selectedBucket ? buildDayGoalBreakdown(timeEntries, selectedBucket.dateKey, colors.mutedForeground) : []),
    [timeEntries, selectedBucket],
  );
  const handleSelectDay = useCallback((dateKey: string) => {
    // Tapping the already-selected bar closes the drill-down rather than
    // re-showing it — the same "tap to toggle" a user expects from any
    // selectable chip.
    setSelectedDayKey((previous) => (previous === dateKey ? null : dateKey));
  }, []);

  // "Time by goal" card: the period-wide sibling of the per-day breakdown
  // above, one level more granular than "Time by category" (grouped by the
  // actual goal rather than its category) and itself drillable one level
  // further — tapping a goal here reveals the tasks that made up its time.
  // This is the concrete gap closed by this change: category and goal
  // totals both already existed, but nothing on the screen broke either of
  // them down to the individual task.
  const goalSlices = useMemo(
    () => buildGoalBreakdown(timeEntries, ranges.current, colors.mutedForeground),
    [timeEntries, ranges],
  );
  // Only a real slice in the *current* goalSlices counts as selected — same
  // reasoning as `selectedBucket` above.
  const selectedGoalSlice = useMemo(
    () => goalSlices.find((slice) => slice.key === selectedGoalKey) ?? null,
    [goalSlices, selectedGoalKey],
  );
  const taskSlices = useMemo(
    () =>
      selectedGoalSlice
        ? buildTaskBreakdown(timeEntries, ranges.current, selectedGoalSlice.key, colors.mutedForeground)
        : [],
    [timeEntries, ranges, selectedGoalSlice],
  );
  const handleSelectGoal = useCallback((key: string) => {
    setSelectedGoalKey((previous) => (previous === key ? null : key));
  }, []);
  const onlyUnattributedGoals = goalSlices.length === 1 && goalSlices[0].key === UNCATEGORIZED_KEY;

  // Time tracked without a goal attached. Sessions can now be started with
  // nothing selected, so this is ordinary rather than exceptional — and it
  // has to be named. Left unlabelled it is just an anonymous grey wedge that
  // looks identical to the donut's "Other (N)" long-tail bucket, so a user
  // whose week is mostly unfiled would have no way to tell why their
  // categories look wrong, or that anything is attachable.
  const unattributedMinutes = useMemo(
    () => slices.find((slice) => slice.key === UNCATEGORIZED_KEY)?.minutes ?? 0,
    [slices],
  );
  const onlyUnattributed = slices.length === 1 && unattributedMinutes > 0;

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

  // src/lib/query-client.ts sets `placeholderData: keepPreviousData` globally,
  // so the instant after a week -> month tap this screen is holding the WEEK
  // window's entries while the month request is in flight — and every total,
  // average and delta below is computed from them. Week-from-month data
  // happens to be right (a subset), but month-from-week undercounts, and
  // either way the numbers on screen aren't the period whose name is above
  // them. Dimming them is what makes that legible instead of a silent wrong
  // answer; the pull-to-refresh spinner is already turning at the same time.
  const isProvisional = timeEntriesQuery.isPlaceholderData;

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
        <HiddenTabBackButton label="Settings" destination="/settings" />
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
        <HiddenTabBackButton label="Settings" destination="/settings" />
        <QueryErrorState
          // Any one of the three carries the same failure here (a cold
          // cache with no network path reaching the server fails all three
          // requests identically), so the first one is representative of
          // what actually happened.
          error={timeEntriesQuery.error ?? activeGoalsQuery.error ?? tasksQuery.error}
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
      <HiddenTabBackButton label="Settings" destination="/settings" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
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

            <Reveal style={[styles.tileRow, isProvisional && styles.provisional]}>
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

            <Reveal delay={70} style={[styles.tileRow, isProvisional && styles.provisional]}>
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

            <Reveal delay={140} style={[styles.section, isProvisional && styles.provisional]}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Focus per day</Text>
                  <Text style={styles.cardTotal}>{formatDuration(currentMinutes)}</Text>
                </View>
                <View
                  style={styles.chartArea}
                  onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
                  accessible
                  accessibilityLabel={buildChartSummary(currentMinutes, elapsedDays, period)}
                >
                  {currentMinutes === 0 ? (
                    <Text style={styles.emptyChartText}>
                      Nothing logged {period === "week" ? "this week" : "this month"} yet.
                    </Text>
                  ) : (
                    <FocusBarChart
                      buckets={buckets}
                      width={chartWidth}
                      labelEvery={period === "week" ? 1 : 7}
                      selectedDateKey={selectedBucket?.dateKey}
                      onSelectDay={handleSelectDay}
                    />
                  )}
                </View>

                {selectedBucket ? (
                  <View style={styles.dayBreakdown}>
                    <View style={styles.dayBreakdownHeader}>
                      <View style={styles.dayBreakdownHeading}>
                        <Text style={styles.dayBreakdownTitle}>{formatDayHeading(selectedBucket.dateKey)}</Text>
                        <Text style={styles.cardTotal}>{formatDuration(selectedBucket.minutes)}</Text>
                      </View>
                      <Pressable
                        onPress={() => setSelectedDayKey(null)}
                        hitSlop={spacing.sm}
                        style={styles.dayBreakdownClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close day breakdown"
                      >
                        <Text style={styles.dayBreakdownCloseText}>Close</Text>
                      </Pressable>
                    </View>
                    {daySlices.length === 0 ? (
                      <Text style={styles.emptyChartText}>Nothing tracked this day.</Text>
                    ) : (
                      <CategoryDonut slices={daySlices} size={donutSize} />
                    )}
                  </View>
                ) : null}
              </View>
            </Reveal>

            <Reveal delay={210} style={[styles.section, isProvisional && styles.provisional]}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Time by category</Text>
                  <Text style={styles.cardTotal}>{slices.length > 0 ? `${slices.length} in play` : ""}</Text>
                </View>
                {slices.length === 0 ? (
                  <Text style={styles.emptyChartText}>
                    Categories show up once your logged time is attached to a goal.
                  </Text>
                ) : onlyUnattributed ? (
                  // Every slice is the uncategorized one, so the donut would
                  // be a single featureless ring. Say what it is instead —
                  // and, critically, confirm the time was counted. Time that
                  // silently vanished from a user's own report would be a
                  // worse bug than the friction one-tap tracking removed.
                  <Text style={styles.emptyChartText}>
                    All {formatDuration(unattributedMinutes)} logged{" "}
                    {period === "week" ? "this week" : "this month"} is counted, but none of it is attached
                    to a goal yet. Tap “Add goal” on a session in the Time Tracker to file it here.
                  </Text>
                ) : (
                  <>
                    <CategoryDonut slices={slices} size={donutSize} />
                    {unattributedMinutes > 0 ? (
                      <Text style={styles.chartFootnote}>
                        {formatDuration(unattributedMinutes)} isn’t attached to a goal yet — it’s the
                        “Uncategorized” slice.
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            </Reveal>

            <Reveal delay={280} style={[styles.section, isProvisional && styles.provisional]}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Time by goal</Text>
                  <Text style={styles.cardTotal}>{goalSlices.length > 0 ? `${goalSlices.length} in play` : ""}</Text>
                </View>
                {goalSlices.length === 0 ? (
                  <Text style={styles.emptyChartText}>
                    Goals show up here once your logged time is attached to one.
                  </Text>
                ) : onlyUnattributedGoals ? (
                  // Same reasoning as "Time by category"'s onlyUnattributed
                  // branch above — a single featureless ring is worse than
                  // just saying what happened to the time.
                  <Text style={styles.emptyChartText}>
                    All {formatDuration(goalSlices[0].minutes)} logged{" "}
                    {period === "week" ? "this week" : "this month"} is counted, but none of it is attached
                    to a goal yet. Tap “Add goal” on a session in the Time Tracker to file it here.
                  </Text>
                ) : (
                  <>
                    <CategoryDonut
                      slices={goalSlices}
                      size={donutSize}
                      onSelectSlice={handleSelectGoal}
                      selectedKey={selectedGoalKey}
                    />
                    <Text style={styles.chartFootnote}>Tap a goal to see which tasks made up its time.</Text>

                    {selectedGoalSlice ? (
                      // Reuses the per-day breakdown's block styling below —
                      // same "child panel reacting to a tap" visual language,
                      // just one level further down the goal → task chain.
                      <View style={styles.dayBreakdown}>
                        <View style={styles.dayBreakdownHeader}>
                          <View style={styles.dayBreakdownHeading}>
                            <Text style={styles.dayBreakdownTitle}>{selectedGoalSlice.name}</Text>
                            <Text style={styles.cardTotal}>{formatDuration(selectedGoalSlice.minutes)}</Text>
                          </View>
                          <Pressable
                            onPress={() => setSelectedGoalKey(null)}
                            hitSlop={spacing.sm}
                            style={styles.dayBreakdownClose}
                            accessibilityRole="button"
                            accessibilityLabel="Close task breakdown"
                          >
                            <Text style={styles.dayBreakdownCloseText}>Close</Text>
                          </Pressable>
                        </View>
                        {taskSlices.length === 0 ? (
                          <Text style={styles.emptyChartText}>Nothing individually tracked under this goal.</Text>
                        ) : (
                          <CategoryDonut slices={taskSlices} size={donutSize} />
                        )}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </Reveal>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One spoken sentence instead of 31 individually-focusable bars.
 *
 * `dayCount` is the number of days that have actually elapsed, not the length
 * of the period: on the 2nd of a month this said "across 31 days", which
 * reads as a month of near-zero activity rather than two days of it.
 */
function buildChartSummary(minutes: number, dayCount: number, period: ReportPeriod): string {
  return `Bar chart of focus time per day. ${formatDuration(minutes)} logged across ${dayCount} ${
    dayCount === 1 ? "day" : "days"
  } so far ${period === "week" ? "this week" : "this month"}.`;
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
    // Keeps "Reports" clear of the layout's floating menu button.
    paddingRight: HAMBURGER_CLEARANCE,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  /** Numbers that belong to a period other than the one named above them. */
  provisional: {
    opacity: 0.45,
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
    // xxl rather than the lg a compact row-card would use: these cards are
    // content-heavy (a chart, a legend, sometimes both at once) and lg's
    // tighter gutter read cramped once the goal drill-down could stack a
    // second block underneath — see tokens.ts's spacing rhythm note.
    padding: spacing.xxl,
    gap: spacing.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  // A card's primary line gets the `title` role, not the tiny uppercase
  // `label` eyebrow style the header above it already uses — two eyebrows
  // stacked (screen eyebrow, then a caps card title) read as flat, same-
  // weight chrome with nothing standing out as the actual heading.
  cardTitle: {
    ...typography.title,
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
  // Sits under a chart that did render, so it gets the tighter spacing the
  // full-height empty state doesn't need.
  chartFootnote: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
    textAlign: "center",
    paddingTop: spacing.md,
  },
  // The per-day goal drill-down, appended under the "Focus per day" chart
  // when a bar is tapped. A top divider is what tells the eye this is a
  // second block reacting to the tap, not part of the chart itself.
  dayBreakdown: {
    marginTop: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  dayBreakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  dayBreakdownHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  dayBreakdownTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  // Styled as a small dismiss chip (same pill-on-a-View idiom StatCard's
  // trend chip uses, rather than colouring the Text node directly — more
  // reliable corner clipping on Android) so it reads as a tappable control
  // and not another piece of copy.
  dayBreakdownClose: {
    backgroundColor: colors.secondary,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
  },
  dayBreakdownCloseText: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
});
