// Goals tab: status-filtered list with mark-complete and delete actions, plus
// the shared QuickAddSheet for title-only creation. Tapping a goal row (not
// the Done/Delete buttons) opens EditGoalSheet for the full edit
// (title/category/target hours/deadline/status/color) — see
// src/components/EditGoalSheet.tsx.
//
// Visual language is ported from dw-time-web's goals page:
//   - src/features/goals/components/goals-filters.tsx:41-52 — the status
//     filter. Web offers ACTIVE / COMPLETED / PAUSED in a <Select>; this is
//     the same three as a segmented control, because hiding a short fixed
//     list behind a tap is pointless on a phone. PAUSED used to be missing
//     here entirely, which meant a goal paused on web simply vanished from
//     the phone with no tab showing it and no control to bring it back. The
//     category and label filters that file also carries are the chip row
//     under the header — see `GoalFilterRow` below; without them the
//     Categories screen produced colors and tags nothing on this screen
//     could be narrowed by.
//   - src/features/goals/components/goals-stats.tsx — the StatCard strip
//     above the list, reproduced as a scroll-away summary row, and the
//     Active/Paused/Completed counts, which ride on the segments themselves
//     rather than costing three more tiles.
//   - src/features/goals/components/goals-list.tsx:32-54 — the empty state's
//     title/description/CTA structure.
//   - src/features/goals/components/goal-item.tsx — the card itself; see
//     src/components/goals/GoalCard.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import {
  GOAL_STATUS_OPTIONS,
  getLocalDateString,
  updateGoalSchema,
  type Goal,
  type GoalFilters,
  type GoalStatus,
} from "@goalslot/shared";

import { QueryErrorState, Skeleton, SkeletonCard } from "@/components";
import { EditGoalSheet, type EditGoalSheetRef } from "@/components/EditGoalSheet";
import { QuickAddSheet } from "@/components/QuickAddSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { GoalCard, GoalsSummary, summariseGoals, SUMMARY_HEIGHT } from "@/components/goals";
import {
  ListEmptyState,
  safeColor,
  ScreenHeader,
  SegmentedControl,
  withAlpha,
  type SegmentOption,
} from "@/components/lists";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { hapticCompletion } from "@/lib/haptics";
import { queueOfflineEdit } from "@/lib/offline";
import { categoryQueries, goalQueries, labelQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useAnalytics } from "@/providers/growth-provider";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";
import { useHiddenTabBackHandler } from "@/components/navigation/HiddenTabBackButton";
import { hiddenTabBackDestination } from "@/lib/hidden-tab-routes";

/** Lower-case name of each tab, for the summary strip and empty copy. */
const STATUS_WORD: Record<GoalStatus, string> = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
};

const EMPTY_TITLE: Record<GoalStatus, string> = {
  ACTIVE: "No active goals yet",
  PAUSED: "Nothing on hold",
  COMPLETED: "No completed goals yet",
};

/** Supporting line under the empty-state headline — web goals-list.tsx:38-42. */
const EMPTY_DESCRIPTION: Record<GoalStatus, string> = {
  ACTIVE: "Create your first goal to start tracking your progress. Log hours against it and watch the ring fill up.",
  PAUSED: "Goals you set aside land here, holding their hours until you pick them back up.",
  COMPLETED: "Goals you finish will be archived here, with the hours you put into each one.",
};

const SKELETON_ROWS = 5;

/**
 * Keys for the category/label filter row. One selection across BOTH axes
 * rather than one per axis: `GET /goals` does accept `categories` and
 * `labelIds` together, but a phone-width chip row is a poor place to compose
 * an intersection, and "show me this one slice" is what the Categories
 * screen's two lists are for. A namespaced key per chip then keeps "which
 * axis is this" out of a second piece of state.
 */
const FILTER_ALL = "all";
const CATEGORY_PREFIX = "category:";
const LABEL_PREFIX = "label:";

interface GoalFilterOption {
  key: string;
  label: string;
  /** The entity's own color, tinted into the chip when it's selected. */
  color?: string | null;
}

export default function GoalsScreen() {
  const [tab, setTab] = useState<GoalStatus>("ACTIVE");
  const analytics = useAnalytics();
  const quickAddRef = useRef<BottomSheetModal>(null);
  const editGoalRef = useRef<EditGoalSheetRef>(null);

  // Today, as a "YYYY-MM-DD" key. Every row is handed the same value so a
  // long list can't disagree with itself about whether a deadline is overdue.
  // Refreshed on focus rather than on a timer: the app sitting open past
  // midnight is the only way this goes stale, and returning to the tab is the
  // next thing that happens after that. Setting the same string is a React
  // bailout, so this costs nothing on a normal focus.
  const [todayKey, setTodayKey] = useState(() => getLocalDateString());

  useScreenView("goals");
  useHiddenTabBackHandler(hiddenTabBackDestination("goals"));

  useFocusEffect(
    useCallback(() => {
      setTodayKey(getLocalDateString());
    }, []),
  );

  // The Categories screen's two lists, read here only to build the filter row
  // below. Both share their cache entries with that screen.
  const categoriesQuery = useQuery(categoryQueries.list());
  const labelsQuery = useQuery(labelQueries.list());

  const categoryOptions = useMemo<GoalFilterOption[]>(
    () =>
      (categoriesQuery.data ?? []).map((category) => ({
        // `value`, not `name`: a goal stores its category's slug (see
        // resolveDefaultCategory in src/hooks/useQuickAdd.ts), and that is
        // what `GET /goals?categories=` matches on.
        key: `${CATEGORY_PREFIX}${category.value}`,
        label: category.name,
        color: category.color,
      })),
    [categoriesQuery.data],
  );
  const labelOptions = useMemo<GoalFilterOption[]>(
    () =>
      (labelsQuery.data ?? []).map((label) => ({
        key: `${LABEL_PREFIX}${label.id}`,
        label: label.name,
        color: label.color,
      })),
    [labelsQuery.data],
  );

  const [filter, setFilter] = useState<string>(FILTER_ALL);
  // A category or label deleted while it was the active filter would otherwise
  // leave this screen filtering by something that no longer exists, with no
  // chip lit to say so. Same guard tasks.tsx applies to its own goal filter.
  const activeFilter =
    filter === FILTER_ALL || [...categoryOptions, ...labelOptions].some((option) => option.key === filter)
      ? filter
      : FILTER_ALL;

  const filters = useMemo<GoalFilters>(() => {
    if (activeFilter.startsWith(CATEGORY_PREFIX)) {
      return { status: tab, categories: [activeFilter.slice(CATEGORY_PREFIX.length)] };
    }
    if (activeFilter.startsWith(LABEL_PREFIX)) {
      return { status: tab, labelIds: [activeFilter.slice(LABEL_PREFIX.length)] };
    }
    return { status: tab };
  }, [activeFilter, tab]);
  // `isPending` (no cached data yet) drives the skeleton; a screen returning
  // to this tab with data already in the query cache renders instantly with
  // `isPending: false`, so no blocking skeleton flashes on cached-first loads.
  // Never `isLoading`/`isFetching` here — both are true on a background
  // revalidation and would blank a perfectly good list on every revisit.
  const { data, error, isPending, isError, isFetching, refetch } = useQuery(goalQueries.list(filters));

  // Web spends three StatCards on these counts (goals-stats.tsx:40-44). One
  // extra query, and deliberately not part of any loading gate: if /goals/stats
  // is slow or fails, the segments simply render without their badges instead
  // of holding up the list.
  const statsQuery = useQuery(goalQueries.stats());

  // GOAL_STATUS_OPTIONS (packages/shared/src/types/goal.ts) is the same
  // ACTIVE / PAUSED / COMPLETED list, in the same order, that web feeds its
  // status <Select> — reused rather than re-typed so the two can't drift.
  const tabOptions = useMemo<SegmentOption<GoalStatus>[]>(() => {
    const stats = statsQuery.data;
    return GOAL_STATUS_OPTIONS.map((entry) => ({
      ...entry,
      count:
        stats === undefined
          ? undefined
          : entry.value === "ACTIVE"
            ? stats.active
            : entry.value === "PAUSED"
              ? stats.paused
              : stats.completed,
    }));
  }, [statsQuery.data]);

  // Both mutations below only ever touch the currently-viewed tab's list
  // query — the completed/deleted goal simply drops out of it. The
  // post-success `invalidateQueries` on `goalQueries.goalQueries.all`
  // reconciles the *other* tabs (e.g. a completed goal reappearing under
  // Completed, and the stats counts) against the server instead of
  // hand-patching every cached key.
  const listKey = useMemo(() => goalQueries.goalQueries.list(filters), [filters]);

  const removeFromCurrentList = useCallback(
    (goalId: string): Goal[] | undefined => {
      const previous = queryClient.getQueryData<Goal[]>(listKey);
      queryClient.setQueryData<Goal[]>(listKey, (existing) => (existing ?? []).filter((g) => g.id !== goalId));
      return previous;
    },
    [listKey],
  );

  const handleComplete = useCallback(
    async (goal: Goal) => {
      const previous = removeFromCurrentList(goal.id);
      try {
        const payload = updateGoalSchema.parse({ status: "COMPLETED" });
        await apiClient.goals.update(goal.id, payload);
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
        hapticCompletion();
        analytics.track({ name: "goalCompleted", payload: { goalId: goal.id } });
      } catch (err) {
        const queued = await queueOfflineEdit("goal-complete", { id: goal.id }, err);
        if (queued) {
          // Stays in the current (Active) tab rather than jumping to
          // Completed — the move is only real once the outbox drains and
          // the post-drain invalidate lands — but tagged so the card reads
          // as "on its way" instead of looking like the tap did nothing.
          queryClient.setQueryData<Goal[]>(
            listKey,
            (previous ?? []).map((g) => (g.id === goal.id ? { ...g, pendingSync: true } : g)),
          );
          notify("Queued — will sync when online", "offline");
        } else {
          queryClient.setQueryData(listKey, previous);
          console.error(err);
          notify(getErrorMessage(err, "Couldn't complete that goal. Please try again."), "error");
        }
      }
    },
    [analytics, listKey, removeFromCurrentList],
  );

  const deleteGoal = useCallback(
    async (goal: Goal) => {
      const previous = removeFromCurrentList(goal.id);
      try {
        await apiClient.goals.delete(goal.id);
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
        analytics.track({ name: "goalDeleted", payload: { goalId: goal.id } });
      } catch (err) {
        const queued = await queueOfflineEdit("goal-delete", { id: goal.id }, err);
        if (queued) {
          // Same reasoning as handleComplete: the goal reappears (a delete
          // that hasn't happened yet shouldn't look like it already did),
          // tagged pending so it's clear the removal is only queued.
          queryClient.setQueryData<Goal[]>(
            listKey,
            (previous ?? []).map((g) => (g.id === goal.id ? { ...g, pendingSync: true } : g)),
          );
          notify("Queued — will sync when online", "offline");
        } else {
          queryClient.setQueryData(listKey, previous);
          console.error(err);
          notify(getErrorMessage(err, "Couldn't delete that goal. Please try again."), "error");
        }
      }
    },
    [analytics, listKey, removeFromCurrentList],
  );

  const [pendingDelete, setPendingDelete] = useState<Goal | null>(null);

  // Mirrors the old Alert.alert's own behaviour: tapping "Delete" dismissed
  // the native alert immediately and let deleteGoal run (and optimistically
  // remove the row) in the background — deleteGoal's own catch already
  // reports a failure via `notify`, so this dialog has nothing left to stay
  // open for.
  const confirmDeleteGoal = useCallback(() => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    void deleteGoal(target);
  }, [deleteGoal, pendingDelete]);

  const openEdit = useCallback((goal: Goal) => {
    editGoalRef.current?.present(goal);
  }, []);

  // `/goals?goalId=…` — see deep-links.ts's goalDeepLink and its "until a
  // screen reads it, the query param is simply ignored" note; this is that
  // screen reading it. Mirrors tasks.tsx's taskId handling below exactly,
  // including the same limitation: the match is only tried against `data`,
  // this screen's currently loaded tab/filter, so a goal search result for a
  // paused/completed goal opened while this screen is still on the Active
  // tab silently finds nothing, same as tasks.tsx's own no-op-if-absent.
  //
  // Guarded by a ref rather than by clearing the param — same reasoning as
  // tasks.tsx: the sheet must open once per link, not again on every
  // re-render or tab re-focus.
  const { goalId: deepLinkGoalId } = useLocalSearchParams<{ goalId?: string }>();
  const handledGoalDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!deepLinkGoalId || handledGoalDeepLinkRef.current === deepLinkGoalId) return;
    const target = data?.find((goal) => goal.id === deepLinkGoalId);
    if (!target) return;
    handledGoalDeepLinkRef.current = deepLinkGoalId;
    openEdit(target);
  }, [data, deepLinkGoalId, openEdit]);

  const openQuickAdd = useCallback(() => {
    quickAddRef.current?.present();
  }, []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Goal>) => (
      <GoalCard
        goal={item}
        index={index}
        todayKey={todayKey}
        onComplete={handleComplete}
        onDelete={setPendingDelete}
        onEdit={openEdit}
      />
    ),
    [handleComplete, openEdit, todayKey],
  );

  const goals = data ?? [];
  const summary = useMemo(() => summariseGoals(data), [data]);

  const listHeader = useMemo(() => {
    if (!summary) return null;
    return (
      <>
        {/* A failed background refetch must not take the screen away: the
            cached list below is still the last thing the server said, so the
            failure is reported as a retry strip above it instead of replacing
            real content with an error page. */}
        {isError ? <StaleNotice onRetry={() => void refetch()} /> : null}
        <GoalsSummary data={summary} statusLabel={STATUS_WORD[tab]} />
      </>
    );
  }, [isError, refetch, summary, tab]);

  // A failure only takes over the screen when there is nothing cached to show
  // (`!data`); with cached goals in hand the list stays and StaleNotice
  // reports the failure instead.
  const showError = isError && !data;
  const showEmpty = !isPending && !showError && goals.length === 0;
  const isFiltered = activeFilter !== FILTER_ALL;
  // Only the Active tab's empty state carries a CTA (web does the same —
  // goals-list.tsx:44-52) — plus any filtered empty state, whose CTA clears
  // the filter. Where there is one, the FAB is hidden: it would land on top
  // of the centred CTA. Same fix as commit 2d1806c on the Schedule tab.
  const emptyStateHasCta = showEmpty && (isFiltered || tab === "ACTIVE");

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <View style={styles.skeletonWrap}>
        {/* Reserves the summary strip's exact height so the rows below don't
            jump down when real data lands. */}
        <Skeleton width="100%" height={SUMMARY_HEIGHT} borderRadius={radii.lg} style={styles.summarySkeleton} />
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          // SkeletonCard, not SkeletonListItem: Skeleton.tsx:152-159 says it
          // was written for "the elevated-card row shape goals.tsx renders",
          // and this screen was the one place still using the thin variant, so
          // the placeholder read as a different list than the one that arrived.
          <SkeletonCard key={index} />
        ))}
      </View>
    );
  } else if (showError) {
    content = <QueryErrorState error={error} message="Couldn't load goals." onRetry={() => void refetch()} />;
  } else if (showEmpty && isFiltered) {
    // The unfiltered copy ("Create your first goal") would be a lie here —
    // there may be plenty of goals, just none in this category or label.
    content = (
      <ListEmptyState
        variant="goals"
        title="Nothing here"
        description={`No ${STATUS_WORD[tab]} goals match this filter.`}
        actionLabel="Clear filter"
        onAction={() => setFilter(FILTER_ALL)}
      />
    );
  } else if (showEmpty) {
    content = (
      <ListEmptyState
        variant="goals"
        title={EMPTY_TITLE[tab]}
        description={EMPTY_DESCRIPTION[tab]}
        actionLabel={tab === "ACTIVE" ? "Create goal" : undefined}
        onAction={tab === "ACTIVE" ? openQuickAdd : undefined}
      />
    );
  } else {
    content = (
      <FlashList
        data={goals}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        // `&& !isPending` so the initial load shows the skeleton alone; without
        // it the pull-to-refresh spinner rides on top of the skeleton and the
        // screen reads as loading twice.
        refreshing={isFetching && !isPending}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    // edges={["top"]} — every route in app/(app)/_layout.tsx sets
    // `headerShown: false`, so without this the header renders underneath the
    // status bar / notch. ScreenHeader then reserves the right-hand gutter for
    // the layout's floating hamburger and drops the segmented control onto its
    // own row below the title, which is what keeps either from colliding with
    // that button.
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        eyebrow="Track"
        title="Goals"
        subtitle="Hours logged against what you said mattered."
        action={<SegmentedControl options={tabOptions} value={tab} onChange={setTab} />}
      />

      {/* Hidden below two chips, the same rule tasks.tsx applies to its goal
          filter: with a single category (every account has at least one) and
          no labels, every goal on screen is already that one bucket. */}
      {categoryOptions.length + labelOptions.length > 1 ? (
        <GoalFilterRow
          categories={categoryOptions}
          labels={labelOptions}
          value={activeFilter}
          onChange={setFilter}
        />
      ) : null}

      <View style={styles.listArea}>{content}</View>

      {emptyStateHasCta ? null : (
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={openQuickAdd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add goal"
          accessibilityHint="Opens the quick-add sheet"
        >
          <Icon name="add" size={26} color={colors.primaryForeground} />
        </Pressable>
      )}

      <QuickAddSheet ref={quickAddRef} kind="goal" />
      <EditGoalSheet ref={editGoalRef} />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete goal?"
        description={pendingDelete ? `"${pendingDelete.title}" will be permanently removed.` : undefined}
        icon="trash"
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDeleteGoal}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

/**
 * The category/label filter, sat under the screen header — the same
 * scrolling chip row src/components/tasks/TaskGoalFilter.tsx introduced for
 * tasks, and for the same reason: the count of buckets is "however many the
 * user made", which a `SegmentedControl` can't lay out. Chips are local to
 * this screen rather than reusing that component because filtering here is
 * done SERVER-side (`GET /goals?categories=&labelIds=`), so there are no
 * per-bucket counts to render, and because the two entity types need the
 * divider below to stay legible as two groups.
 *
 * Categories and labels sit in one row, in that order: they're both "which
 * slice of my goals", and a second row of chips would cost more header than
 * the distinction is worth.
 */
function GoalFilterRow({
  categories,
  labels,
  value,
  onChange,
}: {
  categories: GoalFilterOption[];
  labels: GoalFilterOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterRow}
      contentContainerStyle={styles.filterRowContent}
      accessibilityRole="tablist"
    >
      <FilterChip
        option={{ key: FILTER_ALL, label: "All goals" }}
        selected={value === FILTER_ALL}
        onPress={() => onChange(FILTER_ALL)}
      />
      {categories.map((option) => (
        <FilterChip
          key={option.key}
          option={option}
          selected={option.key === value}
          onPress={() => onChange(option.key)}
        />
      ))}
      {categories.length > 0 && labels.length > 0 ? <View style={styles.filterDivider} /> : null}
      {labels.map((option) => (
        <FilterChip
          key={option.key}
          option={option}
          selected={option.key === value}
          onPress={() => onChange(option.key)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * Selected chips tint off the entity's OWN color (MetaChip's trick, also used
 * by TaskGoalFilter) so a picked filter matches the color the goals it lets
 * through are wearing. Unselected chips stay neutral — the color is what
 * selecting reveals.
 */
function FilterChip({
  option,
  selected,
  onPress,
}: {
  option: GoalFilterOption;
  selected: boolean;
  onPress: () => void;
}) {
  const accent = option.color ? safeColor(option.color, colors.foreground) : null;

  return (
    <Pressable
      style={[
        styles.filterChip,
        {
          // Background fallback is `secondary`, not `foreground`: an option
          // with no color (like "All goals") has no accent to tint, and
          // withAlpha returns its fallback verbatim rather than tinted when
          // there's nothing to alpha-blend — falling back to `foreground`
          // here made a selected colorless chip solid near-black with
          // foreground-colored text on top of it, unreadable.
          backgroundColor: selected ? withAlpha(accent, 0.14, colors.secondary) : colors.secondary,
          borderColor: selected ? withAlpha(accent, 0.5, colors.foreground) : colors.border,
        },
      ]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={option.label}
      accessibilityState={{ selected }}
      hitSlop={4}
    >
      <View style={[styles.filterDot, { backgroundColor: accent ?? colors.mutedForeground }]} />
      <Text
        style={[styles.filterChipText, selected ? styles.filterChipTextSelected : styles.filterChipTextMuted]}
        numberOfLines={1}
      >
        {option.label}
      </Text>
    </Pressable>
  );
}

/**
 * Shown above a list that is still rendering cached goals after a refetch
 * failed. `alert` stands in for a wifi-off glyph, which the icon set doesn't
 * carry yet (flagged in the handover).
 */
function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable
      style={styles.staleNotice}
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Couldn't refresh goals. Showing the last saved copy."
      accessibilityHint="Tap to try again"
    >
      <Icon name="alert" size={14} color={colors.warning} />
      <Text style={styles.staleNoticeText} numberOfLines={1}>
        Couldn&apos;t refresh — showing saved goals
      </Text>
      <Icon name="refresh" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listArea: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    // Clears the tab bar and the FAB.
    paddingBottom: spacing.xxxl * 3,
  },

  // --- Category/label filter row (tasks.tsx styles its own the same way) ---
  filterRow: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  filterRowContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 1,
    minHeight: minTouchTarget - spacing.sm,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  filterDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  filterChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    maxWidth: 140,
  },
  filterChipTextMuted: {
    color: colors.mutedForeground,
  },
  filterChipTextSelected: {
    color: colors.foreground,
  },
  /** Keeps the label chips reading as a second group rather than more categories. */
  filterDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
  },
  skeletonWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  summarySkeleton: {
    marginBottom: spacing.md,
  },

  staleNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    // A real warning-colored border, not the same warningMuted as the fill —
    // matching tasks.tsx's staleBanner, this sheet's near-identical retry
    // strip. The muted-on-muted border used to be invisible against its own
    // background, so the notice read as a flat tint with no defined edge.
    borderColor: colors.warning,
    backgroundColor: colors.warningMuted,
  },
  staleNoticeText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },

  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.fab,
  },
  // Every other pressable on this screen (goal cards, segments) gives some
  // kind of feedback under a finger; the FAB — the screen's most-used
  // control — had none. A flat opacity dip is enough to read as "pressed"
  // without pulling in Reanimated for a one-off static state.
  fabPressed: {
    opacity: 0.85,
  },
});
