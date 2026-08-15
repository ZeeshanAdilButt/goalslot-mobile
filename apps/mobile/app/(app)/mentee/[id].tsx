// A mentee's reports, one level down from the Mentees list. Reuses the
// Reports tab's own aggregation (aggregate.ts) and chart components
// (StatCard/PeriodSelector/FocusBarChart/CategoryDonut/Reveal) unmodified —
// they only ever operated on a `TimeEntry[]`/`Goal[]` handed to them, never
// on `apiClient` directly, so pointing them at a mentee's shared data instead
// of the signed-in user's own is a data-source swap, not a fork.
//
// What's smaller than the Reports tab, and why: goal-slot-api's sharing
// module only exposes a mentee's time entries and goals (see
// packages/shared/src/api/sharing.ts) — not their tasks or categories. So
// there is no "tasks done" tile (no shared task list to count against) and
// the category donut falls back to each entry's own `goal.category` string
// rather than the mentee's own Category color palette (which this app has no
// route to read). Both are honest degradations of a real read, not stubs.
//
// Routed as a hidden tab (`href: null`), same "pushed, not tabbed" pattern
// as message/[id].tsx and note/[id].tsx — see that file's header for why.

import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";

import { calculateProgressPercent, formatDuration, hasResponse } from "@goalslot/shared";

import { EmptyState, QueryErrorState, Skeleton } from "@/components";
import { StatusPill } from "@/components/lists";
import {
  buildCategoryBreakdown,
  buildDayGoalBreakdown,
  buildDayBuckets,
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
import { Avatar } from "@/components/messaging";
import { AssignInstructionSheet } from "@/components/mentees/AssignInstructionSheet";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { apiClient, notify } from "@/lib/api-client";
import { messagingEnabled } from "@/lib/messaging-config";
import { instructionsQueries, messagingQueries, sharingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

const CHART_BLOCK_HEIGHT = 150;
const MAX_DONUT_SIZE = 200;
const DONUT_HORIZONTAL_INSET = 2 * spacing.xl + 2 * spacing.xxl + spacing.xxl;
/** Most recent instructions shown before the list is truncated. */
const MAX_INSTRUCTIONS_SHOWN = 5;

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Inclusive day count for a `YYYY-MM-DD` range — same as reports.tsx's own helper. */
function countDays(range: PeriodRange): number {
  const diffMs = parseDateKey(range.end).getTime() - parseDateKey(range.start).getTime();
  return Math.max(1, Math.round(diffMs / 86_400_000) + 1);
}

export default function MenteeReportScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const ownerId = typeof params.id === "string" ? params.id : "";

  const analytics = useAnalytics();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedGoalKey, setSelectedGoalKey] = useState<string | null>(null);
  const [periodAnchor] = useState(() => new Date());
  const [messagingBusy, setMessagingBusy] = useState(false);
  const [messagingError, setMessagingError] = useState<string | null>(null);
  const assignSheetRef = useRef<BottomSheetModal>(null);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "mentee-report" } });
    }, [analytics]),
  );

  const ranges = useMemo(() => getPeriodRanges(period, periodAnchor), [period, periodAnchor]);

  // The mentee's own directory entry, for their name — read from the
  // Mentees list's own cache first (it's virtually always warm, since this
  // screen is only reachable from there) and refetched only if it isn't.
  const menteesQuery = useQuery(sharingQueries.sharedWithMe());
  const mentee = useMemo(
    () => menteesQuery.data?.find((share) => share.owner.id === ownerId)?.owner,
    [menteesQuery.data, ownerId],
  );
  const menteeName = mentee?.name?.trim() || mentee?.email || "This mentee";

  const timeEntriesQuery = useQuery({
    ...sharingQueries.sharedUserTimeEntries(ownerId, ranges.fetch.start, ranges.fetch.end),
    enabled: ownerId.length > 0,
  });
  const goalsQuery = useQuery({ ...sharingQueries.sharedUserGoals(ownerId), enabled: ownerId.length > 0 });
  const instructionsQuery = useQuery(instructionsQueries.assignedByMe());

  const onRefresh = useCallback(() => {
    void timeEntriesQuery.refetch();
    void goalsQuery.refetch();
    void instructionsQuery.refetch();
  }, [goalsQuery, instructionsQuery, timeEntriesQuery]);

  const isRefreshing =
    (timeEntriesQuery.isFetching && !timeEntriesQuery.isPending) ||
    (goalsQuery.isFetching && !goalsQuery.isPending);

  const timeEntries = useMemo(() => timeEntriesQuery.data ?? [], [timeEntriesQuery.data]);
  const goals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data]);
  const activeGoals = useMemo(() => goals.filter((goal) => goal.status === "ACTIVE"), [goals]);
  const menteeInstructions = useMemo(
    () => (instructionsQuery.data ?? []).filter((instruction) => instruction.assigneeId === ownerId),
    [instructionsQuery.data, ownerId],
  );
  const pendingInstructionCount = useMemo(
    () => menteeInstructions.filter((instruction) => instruction.status === "PENDING").length,
    [menteeInstructions],
  );

  const currentMinutes = useMemo(() => sumMinutesInRange(timeEntries, ranges.current), [timeEntries, ranges]);
  const previousMinutes = useMemo(() => sumMinutesInRange(timeEntries, ranges.previous), [timeEntries, ranges]);

  const buckets = useMemo(() => buildDayBuckets(timeEntries, ranges.current, period), [timeEntries, ranges, period]);
  const slices = useMemo(
    () => buildCategoryBreakdown(timeEntries, ranges.current, [], colors.mutedForeground),
    [timeEntries, ranges],
  );

  const selectedBucket = useMemo(
    () => buckets.find((bucket) => bucket.dateKey === selectedDayKey) ?? null,
    [buckets, selectedDayKey],
  );
  const daySlices = useMemo(
    () => (selectedBucket ? buildDayGoalBreakdown(timeEntries, selectedBucket.dateKey, colors.mutedForeground) : []),
    [timeEntries, selectedBucket],
  );
  const handleSelectDay = useCallback((dateKey: string) => {
    setSelectedDayKey((previous) => (previous === dateKey ? null : dateKey));
  }, []);

  const goalSlices = useMemo(
    () => buildGoalBreakdown(timeEntries, ranges.current, colors.mutedForeground),
    [timeEntries, ranges],
  );
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

  const unattributedMinutes = useMemo(
    () => slices.find((slice) => slice.key === UNCATEGORIZED_KEY)?.minutes ?? 0,
    [slices],
  );
  const onlyUnattributed = slices.length === 1 && unattributedMinutes > 0;

  const elapsedDays = Math.max(1, buckets.filter((bucket) => !bucket.isFuture).length);
  const currentDailyAverage = Math.round(currentMinutes / elapsedDays);
  const previousDailyAverage = Math.round(previousMinutes / countDays(ranges.previous));

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

  const handleMessage = useCallback(async () => {
    if (messagingBusy || !ownerId) return;
    setMessagingBusy(true);
    setMessagingError(null);
    try {
      const response = await apiClient.messaging.createConversation({ userId: ownerId });
      await queryClient.invalidateQueries({ queryKey: messagingQueries.messagingQueries.conversations() });
      router.push(`/message/${response.data.conversationId}`);
    } catch (err) {
      const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
      if (status === 403) {
        setMessagingError(`You can't message ${menteeName} — that sharing connection isn't active any more.`);
      } else if (!hasResponse(err)) {
        setMessagingError("You're offline. Check your connection and try again.");
      } else {
        notify("Couldn't open that conversation.", "error");
      }
    } finally {
      setMessagingBusy(false);
    }
  }, [messagingBusy, menteeName, ownerId]);

  const initialLoad = timeEntriesQuery.isPending && goalsQuery.isPending;
  const initialError =
    timeEntriesQuery.isError && !timeEntriesQuery.data && goalsQuery.isError && !goalsQuery.data;
  const hasAnyActivity = !initialLoad && (timeEntries.length > 0 || goals.length > 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to mentees"
        >
          <Icon name="chevron-left" size={iconSize.lg} color={colors.foreground} />
        </Pressable>
        <Avatar name={menteeName} size={36} />
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {menteeName}
        </Text>
        {messagingEnabled ? (
          <Pressable
            onPress={() => void handleMessage()}
            hitSlop={12}
            style={styles.headerAction}
            disabled={messagingBusy}
            accessibilityRole="button"
            accessibilityLabel={`Message ${menteeName}`}
          >
            <Icon name="messages" size={iconSize.md} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {messagingError ? (
        <Text style={styles.errorBanner} accessibilityRole="alert">
          {messagingError}
        </Text>
      ) : null}

      {initialLoad ? (
        <View style={styles.sectionPadded}>
          <Skeleton width="100%" height={44} borderRadius={radii.full} />
          <View style={styles.tileRow}>
            <Skeleton width="48%" height={104} borderRadius={radii.lg} />
            <Skeleton width="48%" height={104} borderRadius={radii.lg} />
          </View>
          <Skeleton width="100%" height={CHART_BLOCK_HEIGHT + spacing.xxxl} borderRadius={radii.lg} />
        </View>
      ) : initialError ? (
        <QueryErrorState
          error={timeEntriesQuery.error ?? goalsQuery.error}
          message="Couldn't load this mentee's reports."
          onRetry={onRefresh}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} accessibilityLabel="Pull to refresh" />
          }
        >
          {!hasAnyActivity ? (
            <EmptyState
              message="Nothing to report yet"
              description={`${menteeName} hasn't logged any focus time or goals yet.`}
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
                  label="Active goals"
                  value={String(activeGoals.length)}
                  sublabel={activeGoals.length > 0 ? `${avgGoalProgress}% avg progress` : "None yet"}
                />
                <StatCard label="Instructions" value={String(pendingInstructionCount)} sublabel="pending" />
              </Reveal>

              <Reveal delay={140} style={styles.section}>
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Focus per day</Text>
                    <Text style={styles.cardTotal}>{formatDuration(currentMinutes)}</Text>
                  </View>
                  <View style={styles.chartArea} onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}>
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
                        <Text style={styles.dayBreakdownTitle}>{selectedBucket.label}</Text>
                        <Pressable onPress={() => setSelectedDayKey(null)} hitSlop={spacing.sm}>
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

              <Reveal delay={210} style={styles.section}>
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Time by category</Text>
                  </View>
                  {slices.length === 0 ? (
                    <Text style={styles.emptyChartText}>Nothing categorized yet.</Text>
                  ) : onlyUnattributed ? (
                    <Text style={styles.emptyChartText}>
                      All {formatDuration(unattributedMinutes)} logged isn't attached to a goal yet.
                    </Text>
                  ) : (
                    <CategoryDonut slices={slices} size={donutSize} />
                  )}
                </View>
              </Reveal>

              <Reveal delay={280} style={styles.section}>
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Time by goal</Text>
                  </View>
                  {goalSlices.length === 0 ? (
                    <Text style={styles.emptyChartText}>Nothing attached to a goal yet.</Text>
                  ) : onlyUnattributedGoals ? (
                    <Text style={styles.emptyChartText}>
                      All {formatDuration(goalSlices[0].minutes)} logged isn't attached to a goal yet.
                    </Text>
                  ) : (
                    <>
                      <CategoryDonut
                        slices={goalSlices}
                        size={donutSize}
                        onSelectSlice={handleSelectGoal}
                        selectedKey={selectedGoalKey}
                      />
                      {selectedGoalSlice ? (
                        <View style={styles.dayBreakdown}>
                          <View style={styles.dayBreakdownHeader}>
                            <Text style={styles.dayBreakdownTitle}>{selectedGoalSlice.name}</Text>
                            <Pressable onPress={() => setSelectedGoalKey(null)} hitSlop={spacing.sm}>
                              <Text style={styles.dayBreakdownCloseText}>Close</Text>
                            </Pressable>
                          </View>
                          {taskSlices.length === 0 ? (
                            <Text style={styles.emptyChartText}>Nothing individually tracked here.</Text>
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

          {/* Always rendered, regardless of hasAnyActivity: assigning or
              viewing instructions doesn't depend on the mentee having logged
              any goal/time activity yet. Gating this behind that flag hid
              both the assign button and any already-assigned instructions
              for a brand-new mentee, which is what made assignment look
              broken even when the request had actually succeeded. */}
          <Reveal delay={hasAnyActivity ? 340 : 0} style={styles.section}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Instructions</Text>
              </View>
              {menteeInstructions.length === 0 ? (
                <Text style={styles.emptyChartText}>Nothing assigned yet.</Text>
              ) : (
                <View style={styles.instructionsList}>
                  {menteeInstructions.slice(0, MAX_INSTRUCTIONS_SHOWN).map((instruction) => (
                    <View key={instruction.id} style={styles.instructionRow}>
                      <View style={styles.instructionBody}>
                        <Text style={styles.instructionTitle} numberOfLines={2}>
                          {instruction.title}
                        </Text>
                        {instruction.note ? (
                          <Text style={styles.instructionNote} numberOfLines={2}>
                            {instruction.note}
                          </Text>
                        ) : null}
                      </View>
                      <StatusPill
                        label={instruction.status === "DONE" ? "Done" : "Pending"}
                        tone={instruction.status === "DONE" ? "success" : "warning"}
                      />
                    </View>
                  ))}
                </View>
              )}
              <Button
                label="Assign another instruction"
                icon="instructions"
                variant="secondary"
                size="sm"
                onPress={() => assignSheetRef.current?.present()}
                style={styles.assignButton}
              />
            </View>
          </Reveal>
        </ScrollView>
      )}

      <AssignInstructionSheet ref={assignSheetRef} mentee={ownerId ? { id: ownerId, name: menteeName } : null} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    marginLeft: -spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...typography.title,
    flex: 1,
    color: colors.foreground,
  },
  headerAction: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBanner: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: 96,
  },
  sectionPadded: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
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
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
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
  dayBreakdownTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  dayBreakdownCloseText: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  instructionsList: {
    gap: spacing.md,
  },
  instructionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  instructionBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  instructionTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  instructionNote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  assignButton: {
    alignSelf: "flex-start",
  },
});
