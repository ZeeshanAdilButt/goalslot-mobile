// The kanban board for the Tasks screen.
//
// Ports dw-time-web/src/features/tasks/components/task-board.tsx to a phone.
// Web lays its four columns out as a single horizontally-scrolling flex row
// with `snap-x snap-mandatory` and `min-w-[220px]` columns (task-board.tsx:180
// and :239), each column holding its own `VirtualizedList` (:257). That shape
// is already the right one for a phone — it is NOT a 4-up grid — so the
// structure carries over exactly:
//
//   horizontal pager  ->  <ScrollView horizontal snapToInterval>
//   snap-center       ->  decelerationRate="fast" + snapToAlignment
//   per-column list   ->  one <FlashList> per column
//
// One column fills ~78% of the screen so the next one always peeks in from
// the right edge: that peek is the only affordance telling a first-time user
// the board scrolls sideways at all, and it's why the column can't be full
// width.
//
// Each column owns its own FlashList rather than the whole board being one
// list. Orientations differ (pager is horizontal, columns are vertical), so
// this is not the "VirtualizedList nested in a ScrollView with the same
// orientation" case React Native warns about, and every column keeps its own
// recycling pool and its own scroll offset — switching columns doesn't reset
// where you were in the one you left.

import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";

import type { Task } from "@goalslot/shared";

import { TONES } from "@/components/lists";
import { SkeletonListItem } from "@/components/Skeleton";
import { colors, radii, spacing, typography } from "@/theme/tokens";

import { BOARD_COLUMNS, buildBoardColumns, type BoardColumnData } from "./board-columns";
import { TaskBoardCard } from "./TaskBoardCard";

/**
 * Share of the window one column takes. Under ~0.8 the next column peeks in
 * far enough to read as "there's more this way"; at 1.0 the board looks like
 * a single list and nobody swipes. Web's equivalent is `min-w-[220px]` on a
 * viewport that shows several columns at once — the intent (never exactly one
 * column edge-to-edge) is the same.
 */
const COLUMN_WIDTH_RATIO = 0.78;
/** Stops the column stretching to absurd widths on a tablet. */
const MAX_COLUMN_WIDTH = 360;
const COLUMN_GAP = spacing.md;
const SKELETON_CARDS_PER_COLUMN = 3;

export interface TaskBoardProps {
  tasks: Task[];
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onMove: (task: Task) => void;
  /** Pull-to-refresh, wired onto every column's list. */
  refreshing: boolean;
  onRefresh: () => void;
}

export function TaskBoard({ tasks, onComplete, onEdit, onMove, refreshing, onRefresh }: TaskBoardProps) {
  const columnWidth = useColumnWidth();
  const columns = useMemo(() => buildBoardColumns(tasks), [tasks]);

  // FlashList needs a bounded height to virtualise, and a child of a
  // HORIZONTAL ScrollView is only sized on the cross axis by its own content —
  // `flex: 1` there means "grow along x". So the board measures itself once
  // and hands each column an explicit height. Rendering is held back for that
  // one frame rather than mounting four lists at height 0 and re-laying them
  // out immediately after.
  const [boardHeight, setBoardHeight] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setBoardHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <View style={styles.board} onLayout={handleLayout}>
      {boardHeight > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={columnWidth + COLUMN_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={styles.track}
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              width={columnWidth}
              height={boardHeight}
              onComplete={onComplete}
              onEdit={onEdit}
              onMove={onMove}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

interface BoardColumnProps {
  column: BoardColumnData;
  width: number;
  height: number;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onMove: (task: Task) => void;
  refreshing: boolean;
  onRefresh: () => void;
}

function BoardColumn({
  column,
  width,
  height,
  onComplete,
  onEdit,
  onMove,
  refreshing,
  onRefresh,
}: BoardColumnProps) {
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Task>) => (
      <View style={styles.cardWrap}>
        <TaskBoardCard
          task={item}
          tone={column.tone}
          columnTitle={column.title}
          index={index}
          onComplete={onComplete}
          onEdit={onEdit}
          onMove={onMove}
        />
      </View>
    ),
    [column.title, column.tone, onComplete, onEdit, onMove],
  );

  return (
    <View style={[styles.column, { width, height }]}>
      <ColumnHeader column={column} />

      {column.tasks.length > 0 ? (
        <FlashList
          data={column.tasks}
          renderItem={renderItem}
          keyExtractor={(task) => task.id}
          refreshing={refreshing}
          onRefresh={onRefresh}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.columnListContent}
        />
      ) : (
        <EmptyColumn column={column} />
      )}
    </View>
  );
}

function ColumnHeader({ column }: { column: BoardColumnData }) {
  const tone = TONES[column.tone];
  const { tasks, title, helper } = column;

  return (
    <View
      style={styles.columnHeader}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}. ${helper}.`}
    >
      <View style={[styles.columnRule, { backgroundColor: tone.accent }]} />
      <View style={styles.columnTitleBlock}>
        <Text style={styles.columnTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.columnHelper} numberOfLines={1}>
          {helper}
        </Text>
      </View>
      {/* Count pill — web's `rounded-full … tabular-nums` badge
          (task-board.tsx:251), same tone as the rule beside the title. */}
      <View style={[styles.countPill, { backgroundColor: tone.background, borderColor: tone.border }]}>
        <Text style={[styles.countText, { color: tone.foreground }]}>{tasks.length}</Text>
      </View>
    </View>
  );
}

/**
 * Web's empty column is a dashed box reading "Drop tasks here"
 * (task-board.tsx:266-268) — instructions for a gesture that doesn't exist
 * here. Same dashed frame and same job (keep the column legible when it holds
 * nothing), with copy that names what the column is waiting for and points at
 * the control that actually fills it.
 */
function EmptyColumn({ column }: { column: BoardColumnData }) {
  return (
    <View style={styles.emptyColumn}>
      <Text style={styles.emptyTitle}>Nothing in {column.title}</Text>
      <Text style={styles.emptyHint}>Use a card&apos;s Move button to bring one here.</Text>
    </View>
  );
}

/**
 * Cold-start placeholder, shaped like the board rather than like the list —
 * otherwise switching to Board and pulling to refresh flashes a stack of full
 * width rows where columns are about to be.
 *
 * A plain clipped row, not a ScrollView: nothing here is scrollable yet, and
 * a row child sizes itself to the parent's height for free, so this needs no
 * measurement pass.
 */
export function TaskBoardSkeleton() {
  const columnWidth = useColumnWidth();

  return (
    <View style={styles.skeletonBoard} accessibilityLabel="Loading tasks" accessibilityRole="progressbar">
      {BOARD_COLUMNS.map((column) => (
        <View key={column.status} style={[styles.column, styles.skeletonColumn, { width: columnWidth }]}>
          <ColumnHeader column={{ ...column, tasks: [] }} />
          <View style={styles.skeletonList}>
            {Array.from({ length: SKELETON_CARDS_PER_COLUMN }).map((_, index) => (
              <SkeletonListItem key={index} showLeading />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function useColumnWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(Math.round(width * COLUMN_WIDTH_RATIO), MAX_COLUMN_WIDTH);
}

const styles = StyleSheet.create({
  board: {
    flex: 1,
  },
  track: {
    paddingHorizontal: spacing.lg,
    gap: COLUMN_GAP,
  },
  column: {
    borderRadius: radii.xl,
    // Web tints the column surface (`bg-zinc-50/50`, task-board.tsx:39). On a
    // background that is already zinc-50, that reads as nothing; a hairline
    // border is what separates one column from the next here.
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.md,
    overflow: "hidden",
  },
  skeletonBoard: {
    flex: 1,
    flexDirection: "row",
    gap: COLUMN_GAP,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    overflow: "hidden",
  },
  skeletonColumn: {
    alignSelf: "stretch",
  },

  // --- Column header ---
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  columnRule: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: radii.full,
  },
  columnTitleBlock: {
    flex: 1,
    gap: 1,
  },
  columnTitle: {
    // Web's column head is `text-sm font-semibold uppercase tracking-wider`
    // (task-board.tsx:246); `caption` is that shape at 11px, bumped a notch
    // so the head still outweighs the helper line beneath it.
    ...typography.caption,
    fontSize: 13,
    lineHeight: 16,
    color: colors.foreground,
  },
  columnHelper: {
    ...typography.bodySmall,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  countPill: {
    minWidth: 22,
    paddingHorizontal: spacing.xs + 1,
    paddingVertical: 1,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
  },
  countText: {
    ...typography.label,
  },

  // --- Column body ---
  columnListContent: {
    paddingHorizontal: spacing.md,
    // Clears the floating FAB (56pt at `spacing.xxl` from the bottom), the
    // same allowance app/(app)/tasks.tsx makes for its list.
    paddingBottom: spacing.xxxl * 3,
  },
  cardWrap: {
    // Spacing lives on the cell, not as a `gap` on the content container: a
    // recycled FlashList cell carries its own margin with it, whereas a gap
    // is applied by the container and has been inconsistent across platforms.
    marginBottom: spacing.md,
  },
  skeletonList: {
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  emptyColumn: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxl,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
  },
  emptyTitle: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.mutedForeground,
    textAlign: "center",
  },
  emptyHint: {
    ...typography.bodySmall,
    fontSize: 11,
    color: colors.mutedForegroundLight,
    textAlign: "center",
    lineHeight: 15,
  },
});
