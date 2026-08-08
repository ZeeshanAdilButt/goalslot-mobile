// The Today/Agenda screen — the app's landing tab. Composite of a few
// distinct sections (right-now, today's schedule, due-today tasks), so this
// is a plain ScrollView at the top level rather than one big FlashList; the
// "due today" list underneath IS a FlashList since it can plausibly grow
// long (see isDueToday below — it includes all undated active tasks, not
// just ones explicitly due today).
//
// Visual language mirrors dw-time-web's dashboard (src/features/dashboard/
// components/*) and, for the "right now" hero, src/components/focus-now-bar.tsx
// — the web's "what's happening right now / up next" strip, which is
// conceptually the heart of a Today view. See inline notes at each section
// for the specific web pattern being matched.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useFocusEffect, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  findUpcomingScheduleBlocks,
  formatDuration,
  formatTime12h,
  getLocalDateString,
  resolveActiveBlock,
  timeToMinutes,
  type ScheduleBlock,
  type Task,
} from "@goalslot/shared";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { QuickAddSheet, type QuickAddKind } from "@/components/QuickAddSheet";
import { Skeleton, SkeletonListItem } from "@/components/Skeleton";
import { scheduleQueries, taskQueries } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

// There's no user-configured-timezone concept wired up yet (per the project
// brief) — the device's own zone is the best available approximation of
// "what timezone is this schedule being read in right now."
const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Warm "focus" accents used only on the "right now" hero card, mirroring the
// literal values dw-time-web's focus-now-bar.tsx hardcodes for the same
// purpose (a pale-yellow banner needs a legible warm-ink text color, and
// neither exists in the shared token file since it's specific to this one
// surface). Not a theme addition — scoped to this file only.
const FOCUS_TINT = "#FFFBEA"; // web: from-[#fffbea]
const FOCUS_BORDER = "rgba(242, 204, 13, 0.35)"; // web: border-[#f2cc0d]/30
const FOCUS_INK = "#8A7307"; // web: text-[#8a7307]

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

  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  const goalSheetRef = useRef<BottomSheetModal>(null);
  const taskSheetRef = useRef<BottomSheetModal>(null);
  const slotSheetRef = useRef<BottomSheetModal>(null);

  const scheduleQuery = useQuery(scheduleQueries.weekly());
  const tasksQuery = useQuery(taskQueries.list());

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
      await Promise.all([scheduleQuery.refetch(), tasksQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [scheduleQuery, tasksQuery]);

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

  // Genuinely first load: no cached data at all for either query yet, so
  // there's nothing meaningful to render behind a skeleton. Once either
  // query has data (even stale, from the persisted cache), fall through to
  // the real content and let each section show its own inline
  // loading/error state instead of blocking the whole screen.
  const initialLoad = scheduleQuery.isPending && tasksQuery.isPending;
  const initialError =
    scheduleQuery.isError && !scheduleQuery.data && tasksQuery.isError && !tasksQuery.data;

  if (initialLoad) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Skeleton width="60%" height={26} />
            <Skeleton width="40%" height={14} style={styles.headerDateSkeleton} />
          </View>
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

  // Only collapse to the single global empty state once both queries have
  // actually resolved — otherwise a query that's still on its first fetch
  // (no cached data yet) would look indistinguishable from "genuinely
  // nothing today" and flash the wrong state before data arrives.
  const nothingToday =
    !scheduleQuery.isPending &&
    !tasksQuery.isPending &&
    todaysBlocks.length === 0 &&
    dueTodayTasks.length === 0 &&
    !activeBlock;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>
              {greetingFor(now.getHours())}
              {user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </Text>
            <Text style={styles.date}>
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </Text>
          </View>
          <Link href="/settings" asChild>
            <TouchableOpacity
              style={styles.settingsButton}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
            >
              <Text style={styles.settingsButtonIcon}>⚙</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {nothingToday ? (
          <View style={styles.section}>
            <EmptyState message="Nothing on the agenda today." />
          </View>
        ) : (
          <>
            {/* "Right now" — the hero. Mirrors dw-time-web's
                src/components/focus-now-bar.tsx: a warm brand-tinted card
                that leads with a pulsing live indicator, the block title,
                a time chip, an "Xm left" pill, and a progress bar tracking
                elapsed time — instead of a plain labelled list row like the
                other two sections. When nothing is active it falls back to
                a neutral "up next" treatment (still matching the bar's
                up-next chip/countdown), then to the empty state. */}
            <View style={styles.heroWrap}>
              {scheduleQuery.isPending ? (
                <View style={styles.card}>
                  <SkeletonListItem />
                </View>
              ) : activeBlock ? (
                <View style={styles.heroCard}>
                  <View style={styles.heroTopRow}>
                    <View style={styles.liveRow}>
                      <LiveDot />
                      <Text style={styles.liveLabel}>Live now</Text>
                    </View>
                    {activeProgress ? (
                      <View style={styles.heroPill}>
                        <Text style={styles.heroPillText}>
                          {formatDuration(activeProgress.minutesLeft)} left
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={styles.heroTitle}>{activeBlock.title}</Text>
                  <BlockMeta block={activeBlock} tint />

                  {activeProgress ? (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.round(activeProgress.pct * 100)}%` }]} />
                    </View>
                  ) : null}
                </View>
              ) : nextUp.length > 0 ? (
                <View style={styles.heroCardNeutral}>
                  <View style={styles.heroTopRow}>
                    <Text style={styles.upNextLabel}>Up next</Text>
                    {nextUpLabel ? (
                      <View style={styles.heroPillNeutral}>
                        <Text style={styles.heroPillNeutralText}>{nextUpLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.heroTitleNeutral}>{nextUp[0].block.title}</Text>
                  <BlockMeta block={nextUp[0].block} />
                </View>
              ) : (
                <View style={styles.card}>
                  <EmptyState message="Nothing scheduled right now." />
                </View>
              )}
            </View>

            <Section
              title="Today's schedule"
              count={todaysBlocks.length}
              viewAllHref="/schedule"
              viewAllLabel="schedule"
            >
              {scheduleQuery.isPending ? (
                <>
                  <SkeletonListItem />
                  <SkeletonListItem />
                </>
              ) : todaysBlocks.length === 0 ? (
                <EmptyState message="No time blocks scheduled today." />
              ) : (
                todaysBlocks.map((block, index) => (
                  <BlockRow key={block.id} block={block} isLast={index === todaysBlocks.length - 1} />
                ))
              )}
            </Section>

            <Section
              title="Due today"
              count={dueTodayTasks.length}
              viewAllHref="/tasks"
              viewAllLabel="tasks"
            >
              {tasksQuery.isPending ? (
                <>
                  <SkeletonListItem showLeading={false} />
                  <SkeletonListItem showLeading={false} />
                </>
              ) : dueTodayTasks.length === 0 ? (
                <EmptyState message="Nothing due today." />
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
          </>
        )}
      </ScrollView>

      <QuickAddFab open={addPickerOpen} onToggle={() => setAddPickerOpen((v) => !v)} onPick={openQuickAdd} />

      <QuickAddSheet ref={goalSheetRef} kind="goal" />
      <QuickAddSheet ref={taskSheetRef} kind="task" />
      <QuickAddSheet ref={slotSheetRef} kind="slot" />
    </SafeAreaView>
  );
}

// Small pulsing "live" indicator — an expanding, fading ring behind a solid
// dot — mirroring the CSS `animate-ping` dot dw-time-web's focus-now-bar.tsx
// uses next to its "Focus now" label. Built on Reanimated's UI-thread
// primitives, the same pattern Skeleton.tsx already uses for its pulse, so
// it stays smooth regardless of what the JS thread is doing and cancels
// cleanly on unmount.
function LiveDot() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 1.8 }],
    opacity: (1 - progress.value) * 0.55,
  }));

  return (
    <View style={styles.liveDotWrap}>
      <Animated.View style={[styles.liveDotRing, ringStyle]} />
      <View style={styles.liveDotCore} />
    </View>
  );
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
          </TouchableOpacity>
        </Link>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// Shared "time · category" meta row for both the hero card and BlockRow.
// `tint` swaps the muted text/border colors for the warm hero-card variants
// so it reads clearly against the pale-yellow background.
function BlockMeta({ block, tint = false }: { block: ScheduleBlock; tint?: boolean }) {
  return (
    <View style={styles.blockMetaRow}>
      <View style={[styles.timeChip, tint && styles.timeChipTint]}>
        <Text style={[styles.timeChipText, tint && styles.timeChipTextTint]}>
          {formatTime12h(block.startTime)} – {formatTime12h(block.endTime)}
        </Text>
      </View>
      {block.category ? (
        <Text style={[styles.blockCategory, tint && styles.blockCategoryTint]}>{block.category}</Text>
      ) : null}
    </View>
  );
}

function BlockRow({ block, isLast }: { block: ScheduleBlock; isLast: boolean }) {
  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <View style={[styles.accentBar, { backgroundColor: block.color }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{block.title}</Text>
        <BlockMeta block={block} />
      </View>
    </View>
  );
}

const STATUS_COPY: Record<Task["status"], string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  DOING: "In progress",
  DONE: "Done",
};

function TaskRow({ task, isLast }: { task: Task; isLast: boolean }) {
  const isDoing = task.status === "DOING";
  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <View style={[styles.accentBar, isDoing ? styles.accentBarActive : styles.accentBarNeutral]} />
      <View style={styles.rowText}>
        <View style={styles.taskTitleRow}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {task.title}
          </Text>
          <View style={[styles.statusPill, isDoing && styles.statusPillActive]}>
            <Text style={[styles.statusPillText, isDoing && styles.statusPillTextActive]}>
              {STATUS_COPY[task.status]}
            </Text>
          </View>
        </View>
        {task.category || task.estimatedMinutes ? (
          <Text style={styles.rowSubtitle}>
            {[task.category, task.estimatedMinutes ? formatDuration(task.estimatedMinutes) : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>
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
            <TouchableOpacity
              key={kind}
              style={styles.fabOption}
              onPress={() => onPick(kind)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${label.toLowerCase()}`}
            >
              <Text style={styles.fabOptionText}>{label}</Text>
            </TouchableOpacity>
          ))
        : null}
      <TouchableOpacity
        style={styles.fab}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? "Close quick add menu" : "Quick add"}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.fabIcon}>{open ? "×" : "+"}</Text>
      </TouchableOpacity>
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
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  headerDateSkeleton: {
    marginTop: spacing.xxs,
  },
  greeting: {
    ...typography.display,
    fontSize: 26,
    color: colors.foreground,
  },
  date: {
    ...typography.bodySmall,
    fontWeight: "500",
    color: colors.mutedForeground,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsButtonIcon: {
    fontSize: 18,
    color: colors.foreground,
  },

  // "Right now" hero.
  heroWrap: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  heroCard: {
    backgroundColor: FOCUS_TINT,
    borderWidth: 1,
    borderColor: FOCUS_BORDER,
    borderRadius: radii.xl,
    padding: spacing.lg,
    overflow: "hidden",
  },
  heroCardNeutral: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  liveDotWrap: {
    width: 10,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  liveDotRing: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  liveDotCore: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.primaryDark,
  },
  liveLabel: {
    ...typography.label,
    color: FOCUS_INK,
  },
  upNextLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  heroPill: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  heroPillText: {
    ...typography.caption,
    color: colors.primaryForeground,
  },
  heroPillNeutral: {
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  heroPillNeutralText: {
    ...typography.caption,
    color: colors.foreground,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.foreground,
    marginTop: spacing.md,
  },
  heroTitleNeutral: {
    ...typography.h2,
    color: colors.foreground,
    marginTop: spacing.md,
  },
  progressTrack: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: "rgba(24, 24, 27, 0.08)",
    marginTop: spacing.lg,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },

  // Shared block/task meta row.
  blockMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
    flexWrap: "wrap",
  },
  timeChip: {
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  timeChipTint: {
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    borderWidth: 1,
    borderColor: FOCUS_BORDER,
  },
  timeChipText: {
    ...typography.caption,
    fontWeight: "600",
    color: colors.foreground,
  },
  timeChipTextTint: {
    color: FOCUS_INK,
  },
  blockCategory: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  blockCategoryTint: {
    color: FOCUS_INK,
  },

  // Section header (title + count badge + view-all link) and card shell,
  // shared by "Today's schedule" and "Due today".
  section: {
    marginTop: spacing.xl,
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
    minHeight: 32,
    justifyContent: "center",
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
    paddingVertical: spacing.xs,
    overflow: "hidden",
    ...shadows.card,
  },
  taskListContainer: {
    // FlashList needs a layout pass; with scrollEnabled=false it sizes to
    // its content, but a min-height keeps the loading/empty transition from
    // visibly jumping.
    minHeight: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: minRowHeight(),
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  accentBar: {
    width: 4,
    alignSelf: "stretch",
    minHeight: 32,
    borderRadius: radii.full,
  },
  accentBarNeutral: {
    backgroundColor: colors.border,
  },
  accentBarActive: {
    backgroundColor: colors.warning,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  taskTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowTitle: {
    ...typography.body,
    color: colors.foreground,
    flexShrink: 1,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  statusPill: {
    flexShrink: 0,
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusPillActive: {
    backgroundColor: colors.warningMuted,
  },
  statusPillText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.mutedForeground,
  },
  statusPillTextActive: {
    color: colors.warning,
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
  fabIcon: {
    color: colors.primaryForeground,
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 30,
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

// Keeps row touch targets at/above the 44pt minimum without hard-coding a
// magic number inline in the StyleSheet above.
function minRowHeight(): number {
  return 44;
}
