// A month calendar grid producing/consuming the app's canonical "YYYY-MM-DD"
// date string — what `getLocalDateString` (packages/shared/src/scheduling/
// time.ts) already produces everywhere else a local calendar day is stored
// (journal entries, goal deadlines, task due dates), so callers never
// convert between this and a JS Date at the storage boundary.
//
// Pure JS/RN, no native module — see TimePicker.tsx's header comment for why
// that constraint matters this session (a native picker would force every
// active worktree back through the Windows native rebuild this session
// already spent hours fighting).

import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@/theme";
import { Icon } from "@/components/ui/Icon";
import { daysInMonth, firstWeekdayOfMonth, parseDateKey, toDateKey } from "./calendar-math";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export interface DatePickerProps {
  /** "YYYY-MM-DD", or undefined/null for no selection. */
  value?: string | null;
  onChange: (date: string) => void;
  /** "YYYY-MM-DD" — days before this are rendered but not selectable. Optional. */
  minDate?: string;
}

export function DatePicker({ value, onChange, minDate }: DatePickerProps) {
  const selected = useMemo(() => (value ? parseDateKey(value) : null), [value]);
  const today = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }, []);

  // Cursor starts on the selected month if there's a value, otherwise today's
  // month — navigating months doesn't change `value` until a day is tapped.
  const [cursor, setCursor] = useState(() => ({
    year: selected?.year ?? today.year,
    month: selected?.month ?? today.month,
  }));

  const minKey = minDate ?? null;

  const goPrevMonth = useCallback(() => {
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  }, []);
  const goNextMonth = useCallback(() => {
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  }, []);

  const monthLabel = useMemo(
    () => new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [cursor],
  );

  const cells = useMemo(() => {
    const total = daysInMonth(cursor.year, cursor.month);
    const leadingBlanks = firstWeekdayOfMonth(cursor.year, cursor.month);
    const days: Array<{ day: number; key: string } | null> = [];
    for (let i = 0; i < leadingBlanks; i++) days.push(null);
    for (let day = 1; day <= total; day++) {
      days.push({ day, key: toDateKey(cursor.year, cursor.month, day) });
    }
    return days;
  }, [cursor]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={goPrevMonth}
          hitSlop={8}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <View style={styles.flipHorizontal}>
            <Icon name="chevron" size={18} color={colors.foreground} />
          </View>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable
          onPress={goNextMonth}
          hitSlop={8}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Icon name="chevron" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          // Weekday letters repeat (S for Sun and Sat) — index, not the
          // letter, is the only stable key.
          <Text key={i} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={i} style={styles.cell} />;
          const isSelected = value === cell.key;
          const isToday =
            cursor.year === today.year && cursor.month === today.month && cell.day === today.day;
          const isDisabled = minKey !== null && cell.key < minKey;
          return (
            <Pressable
              key={i}
              style={styles.cell}
              disabled={isDisabled}
              onPress={() => onChange(cell.key)}
              accessibilityRole="button"
              accessibilityLabel={cell.key}
              accessibilityState={{ selected: isSelected, disabled: isDisabled }}
            >
              <View
                style={[
                  styles.dayCircle,
                  isSelected && styles.dayCircleSelected,
                  isToday && !isSelected && styles.dayCircleToday,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    isSelected && styles.dayTextSelected,
                    isDisabled && styles.dayTextDisabled,
                  ]}
                >
                  {cell.day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CELL_SIZE = 40;

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  navButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  flipHorizontal: {
    transform: [{ scaleX: -1 }],
  },
  monthLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.foreground,
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.mutedForeground,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircle: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: {
    backgroundColor: colors.primary,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: typography.size.sm,
    color: colors.foreground,
  },
  dayTextSelected: {
    color: colors.primaryForeground,
    fontWeight: typography.weight.bold,
  },
  dayTextDisabled: {
    color: colors.border,
  },
});
