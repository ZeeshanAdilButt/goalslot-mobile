// Horizontal goal filter, sat under the screen header.
//
// The problem this answers: every task on this screen already shows which
// goal it belongs to (TaskMetaChips' goal chip, tinted from `goal.color`),
// but there was no way to go the other direction — start from a goal and see
// only its tasks. Status grouping (BACKLOG/TODO/DOING/DONE — see
// `STATUS_ORDER` in app/(app)/tasks.tsx) is the screen's one existing
// grouping axis, in both List and Board. Goal is a SECOND, orthogonal axis;
// layering it on as a second nested grouping would mean two headers stacked
// per row, which reads as noise. So goal is a FILTER instead: pick one and
// the same List/Board machinery renders exactly as it always did, just over
// a narrowed task set. This component only chooses the goal; the actual
// narrowing is `app/(app)/tasks.tsx`'s job.
//
// A horizontal scroller, not the app's `SegmentedControl`
// (src/components/lists/SegmentedControl.tsx): that control lays out N
// equal-width flex segments, which is right for a fixed 2-3-way switch (List/
// Board, Goals' status tabs) but degrades badly once N is "however many
// goals the user has" — five goals would each get a fifth of the row no
// matter how short their names are. Chips that size to their own label and
// scroll are the native pattern for an open-ended filter set (iOS Photos'
// "Recents/People/Places", most inbox category rows).
//
// Selected-chip styling borrows MetaChip's trick (src/components/lists/
// MetaChip.tsx) of tinting off the entity's OWN color rather than a fixed
// palette slot — a filter chip and the goal chips it's filtering by should
// visibly be the same goal.

import { useCallback, useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { safeColor, withAlpha } from "@/components/lists";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface GoalFilterOption {
  /** `"all"`, `"none"` (the goal-less bucket), or a real goal id. */
  key: string;
  label: string;
  count: number;
  /** Goal's own color, tinted the same way its MetaChip is. Omit for All/No goal. */
  color?: string | null;
}

export interface TaskGoalFilterProps {
  options: GoalFilterOption[];
  value: string;
  onChange: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function TaskGoalFilter({ options, value, onChange, style }: TaskGoalFilterProps) {
  const scrollRef = useRef<ScrollView>(null);
  // Chip x-position within the scroll content, keyed by option key — filled
  // in as each chip's onLayout fires. `value` can become the active goal
  // before this component ever renders it as selected (the auto-default
  // effect in tasks.tsx runs on focus/schedule-block change), and chips
  // reflow whenever the goal list itself changes, so a plain "scroll on
  // mount" wouldn't keep the selected chip in view — this re-derives the
  // target position every time either changes.
  const chipX = useRef<Record<string, number>>({});

  const revealSelected = useCallback((key: string) => {
    const x = chipX.current[key];
    if (x === undefined || !scrollRef.current) return;
    scrollRef.current.scrollTo({ x: Math.max(0, x - spacing.xl), animated: true });
  }, []);

  useEffect(() => {
    revealSelected(value);
  }, [value, revealSelected]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
    >
      {options.map((option) => (
        <GoalFilterChip
          key={option.key}
          option={option}
          selected={option.key === value}
          onPress={() => onChange(option.key)}
          onLayout={(event) => {
            chipX.current[option.key] = event.nativeEvent.layout.x;
            if (option.key === value) revealSelected(option.key);
          }}
        />
      ))}
    </ScrollView>
  );
}

function GoalFilterChip({
  option,
  selected,
  onPress,
  onLayout,
}: {
  option: GoalFilterOption;
  selected: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const accent = option.color ? safeColor(option.color, colors.foreground) : null;

  // Unselected chips stay neutral (colors.secondary) regardless of the
  // goal's color — the color is what SELECTING a goal reveals, the same way
  // an unpressed tab doesn't preview its own content. Selected chips tint
  // off the entity color exactly like MetaChip's goal chip does, so a picked
  // filter and the goal chips it's now filtering to visibly match; "All" and
  // "No goal" (no `color`) fall back to the foreground/dark neutral instead
  // of a semantic tone, since neither represents a real entity color.
  const background = selected ? withAlpha(accent, 0.14, colors.foreground) : colors.secondary;
  const border = selected ? withAlpha(accent, 0.5, colors.foreground) : colors.border;
  const dotColor = accent ?? colors.mutedForeground;
  // withAlpha returns its fallback verbatim (not tinted) when there's no
  // accent to blend, so a selected "All"/"No goal" chip — the comment above
  // deliberately chose the dark-neutral fallback here rather than a light
  // tint like goals.tsx's equivalent chip uses — renders a SOLID
  // foreground-colored background. labelSelected's own color is also
  // foreground, which made the label invisible on exactly that chip.
  const labelColor = selected && !accent ? colors.white : undefined;

  return (
    <Pressable
      style={[styles.chip, { backgroundColor: background, borderColor: border }]}
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityLabel={`${option.label}, ${option.count} task${option.count === 1 ? "" : "s"}`}
      accessibilityState={{ selected }}
      hitSlop={4}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text
        style={[
          styles.label,
          selected ? styles.labelSelected : styles.labelMuted,
          labelColor ? { color: labelColor } : null,
        ]}
        numberOfLines={1}
      >
        {option.label}
      </Text>
      <View style={styles.countPill}>
        <Text style={[styles.countText, selected ? styles.countTextSelected : styles.countTextMuted]}>
          {option.count}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 1,
    minHeight: minTouchTarget - spacing.sm,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: "600",
    maxWidth: 140,
  },
  labelMuted: {
    color: colors.mutedForeground,
  },
  labelSelected: {
    color: colors.foreground,
  },
  countPill: {
    minWidth: 20,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radii.full,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  countText: {
    ...typography.label,
  },
  countTextMuted: {
    color: colors.mutedForeground,
  },
  countTextSelected: {
    color: colors.foreground,
  },
});
