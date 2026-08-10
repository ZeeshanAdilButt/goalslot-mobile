// The Today screen — the app's landing tab.
//
// Structure mirrors dw-time-web's dashboard, which is the product's own
// answer to "what belongs on a landing page":
//   src/features/dashboard/components/dashboard-page.tsx  — section order
//   src/components/focus-now-bar.tsx                      — the "right now" hero
//   src/features/dashboard/components/dashboard-stats.tsx — the 4-up stat grid
//   src/features/dashboard/components/dashboard-goals.tsx — active-goal progress
//   src/features/dashboard/components/dashboard-schedule-cta.tsx — the nav tiles
// Each section component under src/components/today/ carries a comment
// citing the specific web file it's derived from and where it deliberately
// diverges for a phone.
//
// The previous version of this screen collapsed to ONE centered
// "Nothing on the agenda today." line whenever the schedule and task lists
// were both empty — which, on a fresh account or a free evening, is most of
// the time. That single global empty state is gone: every section now stands
// on its own and renders its own designed, actionable empty state, so the
// screen has structure and a next step regardless of how much data exists.
// This is why several sections read from queries that were already being
// fetched elsewhere in the app (goals on the Goals/Reports tabs, time
// entries on Timer/Reports) — same query keys, so they're cache hits rather
// than new endpoints.
//
// Top-level is a plain ScrollView, not a FlashList: these are heterogeneous
// sections, not one long list. The "due today" list underneath IS a FlashList
// since it can plausibly grow long (see isDueToday below — it includes all
// undated active tasks, not just ones explicitly due today).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useFocusEffect, useRouter, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import Animated, { FadeInDown } from "react-native-reanimated";

import {
  findUpcomingScheduleBlocks,
  formatDuration,
  getLocalDateString,
  resolveActiveBlock,
  timeToMinutes,
  type Task,
} from "@goalslot/shared";

import { ErrorState } from "@/components/ErrorState";
import { QuickAddSheet, type QuickAddKind } from "@/components/QuickAddSheet";
import { Skeleton, SkeletonListItem } from "@/components/Skeleton";
import { FocusNowCard } from "@/components/today/FocusNowCard";
import { GoalProgressRow } from "@/components/today/GoalProgressRow";
import { PressableScale } from "@/components/today/PressableScale";
import { QuickActionCard } from "@/components/today/QuickActionCard";
import { SectionEmpty } from "@/components/today/SectionEmpty";
import { StatCard } from "@/components/today/StatCard";
import { TaskRow } from "@/components/today/TaskRow";
import { TimelineRow } from "@/components/today/TimelineRow";
import { Icon } from "@/components/ui/Icon";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { goalQueries, scheduleQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { motion } from "@/theme";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

// There's no user-configured-timezone concept wired up yet (per the project
// brief) — the device's own zone is the best available approximation of
// "what timezone is this schedule being read in right now."
const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The floating hamburger (app/(app)/_layout.tsx) is absolutely positioned at
// top-right over every screen: a 40pt button with a 16pt right margin. The
// header reserves that column so the greeting can never slide underneath it.
const HAMBURGER_CLEARANCE = 64;

// Only the first few goals — the point on Today is a pulse check, not the
// Goals tab. Web slices to 4 (dashboard-goals.tsx:45); 3 fits a phone
// without pushing the nav tiles off the bottom of a plausible scroll.
const GOAL_PREVIEW_COUNT = 3;

// Entrance stagger. Sections resolve top-to-bottom so the eye lands on the
// hero first; ~60ms apart is enough to read as a cascade without the last
// section feeling late. Same FadeInDown vocabulary the auth screens use.
const STAGGER_MS = 60;

const ROUTES = {
  schedule: "/schedule" as Href,
  tasks: "/tasks" as Href,
  goals: "/goals" as Href,
  timer: "/timer" as Href,
  journal: "/journal" as Href,
  settings: "/settings" as Href,
};

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// No due-date/today filter exists on TaskListFilters (see
// packages/shared/src/types/task.ts) — the API only supports status/day/goal
// filters, not "due today". So this fetches the full list and filters
// client-side. "Due today" here means: explicitly due today, OR (judgement
// call) has no due date at all but is actively being worked (TODO/DOING) —
// those are exactly the tasks with no better home on a daily agenda than
// "today". DONE tasks never show, regardless of due date.
function isDueToday(task: Task, todayStr: string): boolean {
  if (task.status === "DONE") return false;
  if (task.dueDate) return task.dueDate.slice(0, 10) === todayStr;
  return task.status === "TODO" || task.status === "DOING";
}

function sortByStatusThenTitle(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === "DOING" ? -1 : b.status === "DOING" ? 1 : 0;
  return a.title.localeCompare(b.title);
}

// Purely a label for a time already known to the caller (an
// UpcomingScheduleBlock's `startsAtUtc`) — no new data, just phrased the way
// dw-time-web's focus-now-bar.tsx phrases its "Up next" countdown.
function describeCountdown(now: Date, startsAt: Date): string {
  const diffMin = Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
  return diffMin <= 0 ? "starting now" : `in ${formatDuration(diffMin)}`;
}

export default function TodayScreen() {
  const { user } = useAuth();
  const analytics = useAnalytics();
  const router = useRouter();
  const reduceMotion = useReduceMotion();

  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  const goalSheetRef = useRef<BottomSheetModal>(null);
  const taskSheetRef = useRef<BottomSheetModal>(null);
  const slotSheetRef = useRef<BottomSheetModal>(null);

  const scheduleQuery = useQuery(scheduleQueries.weekly());
  const tasksQuery = useQuery(taskQueries.list());
  // Both of these reuse query keys other screens already register —
  // `goalQueries.list({status:"ACTIVE"})` and `timeEntryQueries.recent()` are
  // exactly what reports.tsx (and timer.tsx, for the latter) subscribe to —
  // so on a warm cache they cost nothing and stay consistent with those
  // screens instead of drifting.
  const activeGoalsQuery = useQuery(goalQueries.list({ status: "ACTIVE" }));
  const timeEntriesQuery = useQuery(timeEntryQueries.recent());

  // Keeps "right now" honest while the screen sits open — a schedule block
  // that was active a minute ago can silently become stale otherwise. Not
  // wall-clock precise (60s granularity), which is fine for a coarse
  // "what's happening" view.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // useFocusEffect (not a mount-only useEffect) because Today is the tab
  // users bounce back to constantly — each return to it is a real "viewed
  // the agenda" moment worth its own analytics event, not just the first.
  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "today" } });
    }, [analytics]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        scheduleQuery.refetch(),
        tasksQuery.refetch(),
        activeGoalsQuery.refetch(),
        timeEntriesQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [scheduleQuery, tasksQuery, activeGoalsQuery, timeEntriesQuery]);

  const activeBlock = useMemo(
    () => resolveActiveBlock(scheduleQuery.data, now, DEVICE_TIMEZONE),
    [scheduleQuery.data, now],
  );

  const nextUp = useMemo(
    () => (activeBlock ? [] : findUpcomingScheduleBlocks(scheduleQuery.data, now, DEVICE_TIMEZONE, 1)),
    [activeBlock, scheduleQuery.data, now],
  );

  const todaysBlocks = useMemo(() => {
    const blocks = scheduleQuery.data?.[now.getDay()] ?? [];
    return [...blocks].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  }, [scheduleQuery.data, now]);

  const todayStr = useMemo(() => getLocalDateString(now), [now]);

  const dueTodayTasks = useMemo(
    () => (tasksQuery.data ?? []).filter((task) => isDueToday(task, todayStr)).sort(sortByStatusThenTitle),
    [tasksQuery.data, todayStr],
  );

  // Deliberately NOT added to the visible list — the list stays "what's left
  // to do". This only feeds the done/total stat, which is meaningless without
  // a denominator that includes what's already finished.
  const doneTodayCount = useMemo(
    () =>
      (tasksQuery.data ?? []).filter(
        (task) => task.status === "DONE" && task.dueDate?.slice(0, 10) === todayStr,
      ).length,
    [tasksQuery.data, todayStr],
  );

  const plannedMinutesToday = useMemo(
    () =>
      todaysBlocks.reduce(
        (sum, block) => sum + Math.max(0, timeToMinutes(block.endTime) - timeToMinutes(block.startTime)),
        0,
      ),
    [todaysBlocks],
  );

  // `timeEntryQueries.recent()` is a rolling 7-day window, so both of these
  // are slices of one already-cached payload rather than two more fetches.
  const trackedToday = useMemo(
    () =>
      (timeEntriesQuery.data ?? [])
        .filter((entry) => entry.date.slice(0, 10) === todayStr)
        .reduce((sum, entry) => sum + entry.duration, 0),
    [timeEntriesQuery.data, todayStr],
  );

  const trackedRecent = useMemo(
    () => (timeEntriesQuery.data ?? []).reduce((sum, entry) => sum + entry.duration, 0),
    [timeEntriesQuery.data],
  );

  const previewGoals = useMemo(
    () => (activeGoalsQuery.data ?? []).slice(0, GOAL_PREVIEW_COUNT),
    [activeGoalsQuery.data],
  );

  // Derived-only display data for the hero card — computed the same way
  // dw-time-web's focus-now-bar.tsx computes its elapsed-progress bar and
  // "Xm left" chip, from data this screen already has (activeBlock, now).
  // No new fetches, no new state.
  const activeProgress = useMemo(() => {
    if (!activeBlock) return null;
    const startMin = timeToMinutes(activeBlock.startTime);
    const endMin = timeToMinutes(activeBlock.endTime);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const totalLen = Math.max(1, endMin - startMin);
    const elapsed = Math.max(0, Math.min(totalLen, nowMin - startMin));
    return { pct: elapsed / totalLen, minutesLeft: Math.max(0, endMin - nowMin) };
  }, [activeBlock, now]);

  const nextUpLabel = useMemo(
    () => (nextUp.length > 0 ? describeCountdown(now, nextUp[0].startsAtUtc) : null),
    [nextUp, now],
  );

  const openQuickAdd = useCallback((kind: QuickAddKind) => {
    setAddPickerOpen(false);
    const ref = kind === "goal" ? goalSheetRef : kind === "task" ? taskSheetRef : slotSheetRef;
    // QuickAddSheet fires hapticLight() + the `quickAddOpened` analytics
    // event itself from its onChange handler once the sheet reaches its
    // open snap point — firing them again here would double-count.
    ref.current?.present();
  }, []);

  const go = useCallback((href: Href) => router.push(href), [router]);

  // Genuinely first load: no cached data at all for either of the two
  // queries this screen has always depended on, so there's nothing
  // meaningful to render behind a skeleton. Once either has data (even
  // stale, from the persisted cache), fall through to the real content and
  // let each section show its own inline loading/error state instead of
  // blocking the whole screen. Goals/time-entries are deliberately NOT part
  // of this gate — they're supplementary, and waiting on them would make
  // Today slower than it is today.
  const initialLoad = scheduleQuery.isPending && tasksQuery.isPending;
  const initialError =
    scheduleQuery.isError && !scheduleQuery.data && tasksQuery.isError && !tasksQuery.data;

  if (initialLoad) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Skeleton width="35%" height={11} />
          <Skeleton width="65%" height={30} style={styles.headerSkeletonLine} />
          <Skeleton width="45%" height={14} style={styles.headerSkeletonLine} />
        </View>
        <View style={styles.section}>
          <View style={styles.card}>
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (initialError) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ErrorState
          message="Couldn't load today's agenda."
          onRetry={() => {
            void scheduleQuery.refetch();
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
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Stagger index={0} reduceMotion={reduceMotion}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Today</Text>
            <Text style={styles.greeting}>
              {greetingFor(now.getHours())}
              {user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </Text>
            <Text style={styles.date}>
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </Text>
          </View>
        </Stagger>

        <Stagger index={1} reduceMotion={reduceMotion}>
          <View style={styles.heroWrap}>
            <FocusNowCard
              loading={scheduleQuery.isPending}
              activeBlock={activeBlock}
              activeProgress={activeProgress}
              nextBlock={nextUp.length > 0 ? nextUp[0].block : null}
              nextLabel={nextUpLabel}
              onOpenSchedule={() => go(ROUTES.schedule)}
            />
          </View>
        </Stagger>

        {/* 4-up stat grid, 2x2 on a phone — dw-time-web's
            dashboard-stats.tsx is the same four measures (today's focus
            time, a longer-window total, active goals, task throughput) in a
            single row of four. */}
        <Stagger index={2} reduceMotion={reduceMotion}>
          <View style={styles.statGrid}>
            <View style={styles.statRow}>
              <StatCard
                label="Tracked today"
                value={formatDuration(trackedToday)}
                detail={
                  plannedMinutesToday > 0
                    ? `of ${formatDuration(plannedMinutesToday)} planned`
                    : "nothing planned yet"
                }
                icon="timer"
                accent="brand"
                valueSlot={timeEntriesQuery.isPending ? <StatValueSkeleton /> : undefined}
              />
              <StatCard
                label="Tasks done"
                value={`${doneTodayCount}/${doneTodayCount + dueTodayTasks.length}`}
                detail="due today"
                icon="check"
                accent="success"
                valueSlot={tasksQuery.isPending ? <StatValueSkeleton /> : undefined}
              />
            </View>
            <View style={styles.statRow}>
              <StatCard
                label="Active goals"
                value={String(activeGoalsQuery.data?.length ?? 0)}
                detail="in progress"
                icon="goals"
                accent="neutral"
                valueSlot={activeGoalsQuery.isPending ? <StatValueSkeleton /> : undefined}
              />
              <StatCard
                label="Last 7 days"
                value={formatDuration(trackedRecent)}
                detail="time tracked"
                icon="reports"
                accent="neutral"
                valueSlot={timeEntriesQuery.isPending ? <StatValueSkeleton /> : undefined}
              />
            </View>
          </View>
        </Stagger>

        <Stagger index={3} reduceMotion={reduceMotion}>
          <Section
            title="Today's schedule"
            count={todaysBlocks.length}
            viewAllHref={ROUTES.schedule}
            viewAllLabel="schedule"
          >
            {scheduleQuery.isPending ? (
              <>
                <SkeletonListItem />
                <SkeletonListItem />
              </>
            ) : todaysBlocks.length === 0 ? (
              <SectionEmpty
                icon="schedule"
                headline="No time blocks today"
                description="Blocking out even one hour makes the rest of the day easier to defend."
                actionLabel="Open schedule"
                onAction={() => go(ROUTES.schedule)}
              />
            ) : (
              <View style={styles.timeline}>
                {todaysBlocks.map((block, index) => (
                  <TimelineRow
                    key={block.id}
                    block={block}
                    isLast={index === todaysBlocks.length - 1}
                    isNow={block.id === activeBlock?.id}
                  />
                ))}
              </View>
            )}
          </Section>
        </Stagger>

        <Stagger index={4} reduceMotion={reduceMotion}>
          <Section title="Due today" count={dueTodayTasks.length} viewAllHref={ROUTES.tasks} viewAllLabel="tasks">
            {tasksQuery.isPending ? (
              <>
                <SkeletonListItem showLeading={false} />
                <SkeletonListItem showLeading={false} />
              </>
            ) : dueTodayTasks.length === 0 ? (
              <SectionEmpty
                icon="tasks"
                headline={doneTodayCount > 0 ? "All clear for today" : "Nothing due today"}
                description={
                  doneTodayCount > 0
                    ? `You closed out ${doneTodayCount} ${doneTodayCount === 1 ? "task" : "tasks"} today. Nothing else is on the hook.`
                    : "Pull something forward from the backlog, or enjoy the quiet day."
                }
                actionLabel="Browse tasks"
                onAction={() => go(ROUTES.tasks)}
              />
            ) : (
              <View style={styles.taskListContainer}>
                <FlashList
                  data={dueTodayTasks}
                  keyExtractor={(task) => task.id}
                  renderItem={({ item, index }) => (
                    <TaskRow task={item} isLast={index === dueTodayTasks.length - 1} />
                  )}
                  // Nested inside the outer ScrollView, which already owns
                  // the page's scrolling — this list only needs to lay out
                  // its (potentially long) content, not scroll on its own.
                  scrollEnabled={false}
                />
              </View>
            )}
          </Section>
        </Stagger>

        <Stagger index={5} reduceMotion={reduceMotion}>
          <Section
            title="Goal progress"
            count={activeGoalsQuery.data?.length ?? 0}
            viewAllHref={ROUTES.goals}
            viewAllLabel="goals"
          >
            {activeGoalsQuery.isPending ? (
              <>
                <SkeletonListItem showLeading={false} />
                <SkeletonListItem showLeading={false} />
              </>
            ) : previewGoals.length === 0 ? (
              <SectionEmpty
                icon="goals"
                headline="No active goals"
                description="Goals are what the time blocks are for. Set one and today's hours start adding up to something."
                actionLabel="Create a goal"
                onAction={() => openQuickAdd("goal")}
              />
            ) : (
              previewGoals.map((goal, index) => (
                <GoalProgressRow key={goal.id} goal={goal} isLast={index === previewGoals.length - 1} />
              ))
            )}
          </Section>
        </Stagger>

        {/* Nav tiles last, in thumb reach. The tab bar only holds five
            destinations; everything else lives behind a hamburger most
            users never open, which was a confirmed discoverability problem
            (see the note in app/(app)/_layout.tsx). */}
        <Stagger index={6} reduceMotion={reduceMotion}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Jump back in</Text>
            <View style={styles.actionGrid}>
              <View style={styles.actionRow}>
                <QuickActionCard
                  title="Schedule"
                  subtitle="Plan your week"
                  icon="schedule"
                  tone="brand"
                  accessibilityLabel="Open schedule"
                  onPress={() => go(ROUTES.schedule)}
                />
                <QuickActionCard
                  title="Timer"
                  subtitle="Track focus time"
                  icon="timer"
                  accessibilityLabel="Open timer"
                  onPress={() => go(ROUTES.timer)}
                />
              </View>
              <View style={styles.actionRow}>
                <QuickActionCard
                  title="Journal"
                  subtitle="Reflect on today"
                  icon="journal"
                  accessibilityLabel="Open journal"
                  onPress={() => go(ROUTES.journal)}
                />
                <QuickActionCard
                  title="Settings"
                  subtitle="Preferences"
                  icon="settings"
                  accessibilityLabel="Open settings"
                  onPress={() => go(ROUTES.settings)}
                />
              </View>
            </View>
          </View>
        </Stagger>
      </ScrollView>

      <QuickAddFab open={addPickerOpen} onToggle={() => setAddPickerOpen((v) => !v)} onPick={openQuickAdd} />

      <QuickAddSheet ref={goalSheetRef} kind="goal" />
      <QuickAddSheet ref={taskSheetRef} kind="task" />
      <QuickAddSheet ref={slotSheetRef} kind="slot" />
    </SafeAreaView>
  );
}

/**
 * Wraps a section in the shared entrance animation so the delay math lives
 * in one place instead of being re-derived at seven call sites. Renders a
 * plain view under reduce-motion — content still appears instantly, it just
 * doesn't travel.
 */
function Stagger({
  index,
  reduceMotion,
  children,
}: {
  index: number;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  return (
    <Animated.View
      entering={
        reduceMotion ? undefined : FadeInDown.duration(motion.duration.base).delay(index * STAGGER_MS)
      }
    >
      {children}
    </Animated.View>
  );
}

/** Placeholder sized to the stat value's 30px line so tiles don't resize when data lands. */
function StatValueSkeleton() {
  return <Skeleton width="60%" height={30} borderRadius={8} />;
}

function Section({
  title,
  count,
  viewAllHref,
  viewAllLabel,
  children,
}: {
  title: string;
  count: number;
  viewAllHref: Href;
  viewAllLabel: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {count > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
          ) : null}
        </View>
        <Link href={viewAllHref} asChild>
          <TouchableOpacity
            style={styles.viewAllButton}
            accessibilityRole="button"
            accessibilityLabel={`View all ${viewAllLabel}`}
            hitSlop={{ top: spacing.sm, bottom: spacing.sm, left: spacing.sm, right: spacing.sm }}
          >
            <Text style={styles.viewAllText}>View all</Text>
            <Icon name="chevron" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </Link>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const ADD_KINDS: { kind: QuickAddKind; label: string }[] = [
  { kind: "slot", label: "Slot" },
  { kind: "task", label: "Task" },
  { kind: "goal", label: "Goal" },
];

function QuickAddFab({
  open,
  onToggle,
  onPick,
}: {
  open: boolean;
  onToggle: () => void;
  onPick: (kind: QuickAddKind) => void;
}) {
  return (
    <View style={styles.fabContainer} pointerEvents="box-none">
      {open
        ? ADD_KINDS.map(({ kind, label }) => (
            <PressableScale
              key={kind}
              style={styles.fabOption}
              // The sheet's own onChange fires hapticLight() when it reaches
              // its open snap point — a second one here would double-tap.
              haptic={false}
              onPress={() => onPick(kind)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${label.toLowerCase()}`}
            >
              <Text style={styles.fabOptionText}>{label}</Text>
            </PressableScale>
          ))
        : null}
      <PressableScale
        style={styles.fab}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? "Close quick add menu" : "Quick add"}
        accessibilityState={{ expanded: open }}
      >
        <Icon name={open ? "close" : "add"} size={26} color={colors.primaryForeground} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl * 3,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingRight: HAMBURGER_CLEARANCE,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  headerSkeletonLine: {
    marginTop: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  greeting: {
    // Explicit rather than a token: the semantic scale jumps from 20px
    // (`h1`) straight to the 72px timer `display`, and the screen's title
    // needs the step between. Negative tracking keeps a long
    // "Good afternoon, Alexander" from looking loose at this size.
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.9,
    color: colors.foreground,
    marginTop: 2,
  },
  date: {
    ...typography.bodySmall,
    fontWeight: "500",
    color: colors.mutedForeground,
    marginTop: 2,
  },

  heroWrap: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
  },

  statGrid: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  statRow: {
    flexDirection: "row",
    gap: spacing.md,
  },

  section: {
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.foreground,
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 32,
  },
  viewAllText: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.card,
  },
  timeline: {
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
  },
  taskListContainer: {
    // FlashList needs a layout pass; with scrollEnabled=false it sizes to
    // its content, but a min-height keeps the loading/empty transition from
    // visibly jumping.
    minHeight: 1,
  },

  actionGrid: {
    gap: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
  },

  fabContainer: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    alignItems: "flex-end",
    gap: spacing.md,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.fab,
  },
  fabOption: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.foreground,
    ...shadows.fab,
  },
  fabOptionText: {
    color: colors.white,
    fontWeight: "600",
    fontSize: 14,
  },
});
