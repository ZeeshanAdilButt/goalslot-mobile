// The Today/Agenda screen — the app's landing tab. Composite of a few
// distinct sections (right-now, today's schedule, due-today tasks), so this
// is a plain ScrollView at the top level rather than one big FlashList; the
// "due today" list underneath IS a FlashList since it can plausibly grow
// long (see isDueToday below — it includes all undated active tasks, not
// just ones explicitly due today).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

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

// There's no user-configured-timezone concept wired up yet (per the project
// brief) — the device's own zone is the best available approximation of
// "what timezone is this schedule being read in right now."
const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
          <Skeleton width="60%" height={22} />
          <Skeleton width="40%" height={14} style={styles.headerDateSkeleton} />
        </View>
        <View style={styles.section}>
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
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
          <Text style={styles.greeting}>
            {greetingFor(now.getHours())}
            {user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </Text>
          <Text style={styles.date}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </Text>
        </View>

        {nothingToday ? (
          <EmptyState message="Nothing on the agenda today." />
        ) : (
          <>
            <Section title="Right now">
              {scheduleQuery.isPending ? (
                <SkeletonListItem />
              ) : activeBlock ? (
                <BlockRow block={activeBlock} />
              ) : nextUp.length > 0 ? (
                <View>
                  <Text style={styles.upNextLabel}>Up next</Text>
                  <BlockRow block={nextUp[0].block} />
                </View>
              ) : (
                <EmptyState message="Nothing scheduled right now." />
              )}
            </Section>

            <Section title="Today's schedule">
              {scheduleQuery.isPending ? (
                <>
                  <SkeletonListItem />
                  <SkeletonListItem />
                </>
              ) : todaysBlocks.length === 0 ? (
                <EmptyState message="No time blocks scheduled today." />
              ) : (
                todaysBlocks.map((block) => <BlockRow key={block.id} block={block} />)
              )}
            </Section>

            <Section title="Due today">
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
                    renderItem={({ item }) => <TaskRow task={item} />}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function BlockRow({ block }: { block: ScheduleBlock }) {
  return (
    <View style={styles.row}>
      <View style={[styles.colorDot, { backgroundColor: block.color }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{block.title}</Text>
        <Text style={styles.rowSubtitle}>
          {formatTime12h(block.startTime)} – {formatTime12h(block.endTime)}
          {block.category ? ` · ${block.category}` : ""}
        </Text>
      </View>
    </View>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <View style={styles.row}>
      <View style={[styles.statusDot, task.status === "DOING" && styles.statusDotActive]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{task.title}</Text>
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
    backgroundColor: "#FFFFFF",
  },
  scrollContent: {
    paddingBottom: 96,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 4,
  },
  headerDateSkeleton: {
    marginTop: 4,
  },
  greeting: {
    fontSize: 22,
    fontWeight: "700",
  },
  date: {
    fontSize: 14,
    opacity: 0.6,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    opacity: 0.5,
    marginBottom: 4,
  },
  upNextLabel: {
    fontSize: 12,
    fontWeight: "600",
    opacity: 0.5,
    marginBottom: 4,
  },
  taskListContainer: {
    // FlashList needs a layout pass; with scrollEnabled=false it sizes to
    // its content, but a min-height keeps the loading/empty transition from
    // visibly jumping.
    minHeight: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#CBD5E1",
  },
  statusDotActive: {
    backgroundColor: "#2563EB",
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "500",
  },
  rowSubtitle: {
    fontSize: 13,
    opacity: 0.6,
  },
  fabContainer: {
    position: "absolute",
    right: 20,
    bottom: 24,
    alignItems: "flex-end",
    gap: 12,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1F2933",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabIcon: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 30,
  },
  fabOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#334155",
  },
  fabOptionText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
});
