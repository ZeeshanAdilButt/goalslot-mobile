// Bottom sheet for choosing what a session is tracked against.
//
// Rows rather than the wrap of pills this replaces: pills truncate real task
// titles badly at phone width and give nowhere to put the parent goal, and a
// full-width row is a far easier target than a half-width chip.
//
// GOALS COME FIRST, then tasks. A goal is the attribution people actually
// reach for — a task is a narrower thing that happens to imply one — and the
// ordering here matches the rest of the product's "goal before category"
// direction. Attaching either is optional: the sheet's first row clears the
// target entirely, because a session with nothing attached is a legitimate
// end state, not an unfinished form.
//
// SEARCH SEARCHES EVERYTHING. The matching rules live in ./tracking-search.ts
// and take a query and nothing else — see that file's header for the web bug
// (a pre-selected category silently hiding a goal, so typing its real name
// returned "No matches") that the split exists to make impossible here. When
// a query does come back empty the sheet says which query failed and offers
// to clear it, rather than leaving the user staring at a bare "No matches"
// with no idea that a filter is in play.
//
// Selection semantics: picking a task clears any picked goal and vice versa
// (see timer.tsx's handlers) — a run is tracked against one or the other,
// never both.

import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Goal, Task } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { filterGoals, filterTasks, normalizeQuery } from "@/components/timer/tracking-search";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface TrackingPickerProps {
  visible: boolean;
  tasks: Task[];
  goals: Goal[];
  /** Currently picked id (task or goal), so the sheet can show what's selected. */
  selectedId?: string | null;
  onPickTask: (task: Task) => void;
  onPickGoal: (goal: Goal) => void;
  /** Clears the target — "just track time", and the way an attached session gets detached again. */
  onPickNone: () => void;
  onClose: () => void;
  /**
   * Which of the sheet's three jobs this is, which is purely a copy
   * difference: setting up the next run ("prestart"), attaching to a session
   * that is already counting ("running"), or filing an entry that has
   * already been logged ("logged").
   */
  mode?: "prestart" | "running" | "logged";
}

export function TrackingPicker({
  visible,
  tasks,
  goals,
  selectedId,
  onPickTask,
  onPickGoal,
  onPickNone,
  onClose,
  mode = "prestart",
}: TrackingPickerProps) {
  // A `Modal` renders outside the screen's SafeAreaView, so the sheet has to
  // apply the bottom inset itself — without it the Cancel target sits under
  // the home indicator on every gesture-nav device.
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const visibleGoals = useMemo(() => filterGoals(goals, query), [goals, query]);
  const visibleTasks = useMemo(() => filterTasks(tasks, query), [tasks, query]);

  const searching = normalizeQuery(query).length > 0;
  const noResults = searching && visibleGoals.length === 0 && visibleTasks.length === 0;
  // Distinguishes "your search matched nothing" from "you have nothing yet" —
  // the two need completely different copy, and conflating them is what makes
  // an empty state useless.
  const nothingToShow = !searching && goals.length === 0 && tasks.length === 0;

  const clearSearch = () => setQuery("");

  const handleClose = () => {
    // A stale query would otherwise still be filtering the list the next time
    // the sheet opens, which reads as "my goals disappeared".
    clearSearch();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable
        style={styles.backdrop}
        onPress={handleClose}
        accessibilityRole="button"
        accessibilityLabel="Close picker"
      >
        {/* Purely a tap-swallower so presses inside the sheet don't reach the
            backdrop. `accessible={false}` keeps it out of the accessibility
            tree — as a Pressable it was otherwise focusable, and being
            unlabelled it announced as a bare "button" wrapping the whole
            sheet. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
          onPress={(event) => event.stopPropagation()}
          accessible={false}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>
            {mode === "prestart" ? "What are you tracking?" : "Attach to this session"}
          </Text>
          <Text style={styles.subtitle}>
            {mode === "running"
              ? "Your time keeps counting either way — this just files it somewhere."
              : mode === "logged"
                ? "Files time you've already logged under a goal or task."
                : "Optional. You can start now and attach a goal later, or never."}
          </Text>

          <View style={styles.searchRow}>
            <Icon name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search goals and tasks"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search goals and tasks"
              accessibilityHint="Searches all of your goals and tasks by name or category"
            />
            {searching ? (
              <Pressable
                onPress={clearSearch}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                // Keeps the glyph's tap area at the 44pt minimum without
                // making the search row itself that tall.
                hitSlop={spacing.md}
              >
                <Icon name="close" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Hidden while searching (it isn't a search result, and it would
                sit above the actual matches competing for the first tap), and
                in "logged" mode, where the sheet is only ever opened from an
                entry that already has nothing attached — so "attach nothing"
                would be a row that does nothing. */}
            {!searching && mode !== "logged" ? (
              <PickerRow
                title={mode === "running" ? "No goal — just track time" : "Just track time"}
                subtitle="Log the time without attaching it to anything"
                accentColor={null}
                selected={!selectedId}
                accessibilityLabel="Track without a goal or task"
                onPress={onPickNone}
              />
            ) : null}

            {noResults ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No goals or tasks match “{query.trim()}”</Text>
                <Text style={styles.emptyBody}>
                  This searched all {goals.length} of your goals and {tasks.length} tasks — nothing else is
                  filtering the list.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.clearButton, pressed && styles.rowPressed]}
                  onPress={clearSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search and show everything"
                >
                  <Text style={styles.clearButtonText}>Clear search</Text>
                </Pressable>
              </View>
            ) : nothingToShow ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Nothing to attach yet</Text>
                <Text style={styles.emptyBody}>
                  You don’t have any goals or tasks. Start the timer anyway — you can attach one later, from
                  this sheet or from the session in your history.
                </Text>
              </View>
            ) : (
              <>
                {/* Goals before tasks — see this file's header. */}
                {visibleGoals.length > 0 ? (
                  <>
                    <SectionLabel text="Goals" count={visibleGoals.length} />
                    {visibleGoals.map((goal) => (
                      <PickerRow
                        key={goal.id}
                        title={goal.title}
                        subtitle={goal.category || null}
                        accentColor={goal.color}
                        selected={selectedId === goal.id}
                        accessibilityLabel={`Track goal "${goal.title}"`}
                        onPress={() => onPickGoal(goal)}
                      />
                    ))}
                  </>
                ) : null}

                {visibleTasks.length > 0 ? (
                  <>
                    <SectionLabel text="Tasks" count={visibleTasks.length} />
                    {visibleTasks.map((task) => (
                      <PickerRow
                        key={task.id}
                        title={task.title}
                        subtitle={task.goal?.title ?? null}
                        accentColor={task.goal?.color ?? null}
                        selected={selectedId === task.id}
                        accessibilityLabel={`Track task "${task.title}"`}
                        onPress={() => onPickTask(task)}
                      />
                    ))}
                  </>
                ) : null}
              </>
            )}
          </ScrollView>

          <Pressable
            style={styles.closeButton}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SectionLabel({ text, count }: { text: string; count: number }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{text}</Text>
      {count > 0 ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

interface PickerRowProps {
  title: string;
  subtitle: string | null;
  accentColor: string | null;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}

function PickerRow({ title, subtitle, accentColor, selected, accessibilityLabel, onPress }: PickerRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
    >
      <View style={[styles.rowDot, { backgroundColor: accentColor ?? colors.border }]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={18} color={colors.foreground} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    // paddingBottom is applied inline, from the safe-area inset.
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: spacing.xxs,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    // 16pt keeps iOS from zooming the field on focus, matching the other
    // text inputs in the app (see ScheduleBlockSheet's `input`).
    fontSize: 16,
    color: colors.foreground,
    paddingVertical: spacing.sm,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  sectionCount: {
    ...typography.label,
    color: colors.mutedForeground,
    opacity: 0.7,
  },
  emptyState: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  clearButton: {
    alignSelf: "flex-start",
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
  clearButtonText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowSelected: {
    borderColor: colors.foreground,
    backgroundColor: colors.secondary,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  closeButton: {
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
});
