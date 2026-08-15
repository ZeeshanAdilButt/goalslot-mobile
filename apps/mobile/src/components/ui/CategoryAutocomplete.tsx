// Inline browse-or-type picker for a goal's / schedule block's category
// field. Until this existed, EditGoalSheet.tsx and ScheduleBlockSheet.tsx
// each had this field as a bare text input with no connection at all to the
// user's real categories — they only ever matched the typed text against
// `categoryQueries.list()` afterwards, purely to derive a color. There was no
// way to see or browse what already exists, which is the reported bug: a
// "category dropdown" that never showed any categories.
//
// This does NOT turn the field into a closed enum. `onChangeText` still fires
// on every keystroke exactly like a plain input, so typing a brand-new name
// keeps working — that's what actually creates a category on first use (see
// useQuickAdd.ts's `resolveDefaultCategory`). Focusing the field additionally
// opens an inline list of existing categories, filtered by whatever's typed
// so far; tapping a row calls `onChangeText` with that category's name, the
// same as if the user had typed it. Picking and typing are the same
// operation as far as any caller is concerned.
//
// The dropdown renders inline (pushes the sheet's content down), not
// absolutely positioned or in its own nested ScrollView — both host sheets
// already use `enableDynamicSizing` and re-measure on content change (see
// EditGoalSheet's deadline calendar for the existing precedent of an inline
// expanding control inside a BottomSheetScrollView), and a nested ScrollView
// here would risk fighting @gorhom/bottom-sheet's own pan/gesture handling
// the way TrackingPicker.tsx's header explicitly avoids for a horizontal
// scroller. The list is capped at MAX_VISIBLE_MATCHES for the same reason —
// a long, further-scrolling inline list would dominate the sheet — with a
// "+N more" hint telling the user to keep typing to narrow it down.
//
// Renders BottomSheetTextInput, not a plain TextInput: every call site lives
// inside a @gorhom/bottom-sheet BottomSheetScrollView, which needs its own
// gesture-aware text input for the sheet's keyboard handling to work (see
// every other input in EditGoalSheet.tsx / ScheduleBlockSheet.tsx).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import type { Category } from "@goalslot/shared";

import { filterCategories } from "@/components/ui/category-search";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Rows shown before the list is truncated in favor of a "+N more" hint. */
const MAX_VISIBLE_MATCHES = 6;

// How long to keep the dropdown open past a blur, so a tap on one of its rows
// has time to land before the list it's tapping disappears out from under it
// — the input blurs on touch-DOWN, but a Pressable's onPress doesn't fire
// until touch-UP, so closing synchronously on blur would swallow the tap.
const BLUR_CLOSE_DELAY_MS = 150;

export interface CategoryAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  categories: Category[];
  placeholder?: string;
  accessibilityLabel: string;
  /** Applied to the root container — e.g. `flex: 1` when this sits beside a color swatch. */
  style?: StyleProp<ViewStyle>;
}

export function CategoryAutocomplete({
  value,
  onChangeText,
  categories,
  placeholder,
  accessibilityLabel,
  style,
}: CategoryAutocompleteProps) {
  const [focused, setFocused] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const handleFocus = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    closeTimer.current = setTimeout(() => setFocused(false), BLUR_CLOSE_DELAY_MS);
  }, []);

  const matches = useMemo(() => filterCategories(categories, value), [categories, value]);
  const visibleMatches = matches.slice(0, MAX_VISIBLE_MATCHES);
  const hiddenCount = matches.length - visibleMatches.length;
  const dropdownOpen = focused && visibleMatches.length > 0;

  const handlePick = useCallback(
    (category: Category) => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      onChangeText(category.name);
      setFocused(false);
    },
    [onChangeText],
  );

  return (
    <View style={style}>
      <BottomSheetTextInput
        style={[styles.input, focused && styles.inputFocused]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        accessibilityLabel={accessibilityLabel}
      />
      {dropdownOpen ? (
        <View style={styles.dropdown}>
          {visibleMatches.map((category) => (
            <Pressable
              key={category.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => handlePick(category)}
              accessibilityRole="button"
              accessibilityLabel={`Use category ${category.name}`}
            >
              <View style={[styles.dot, { backgroundColor: category.color }]} />
              <Text style={styles.rowText} numberOfLines={1}>
                {category.name}
              </Text>
            </Pressable>
          ))}
          {hiddenCount > 0 ? (
            <Text style={styles.moreHint}>
              +{hiddenCount} more — keep typing to narrow it down
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Identical to EditGoalSheet.tsx / ScheduleBlockSheet.tsx's own `input` —
  // this replaces their bare BottomSheetTextInput in place, so it has to
  // look exactly the same.
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.select({ ios: spacing.md, android: spacing.sm, default: spacing.sm + spacing.xxs }),
    fontSize: 16,
    color: colors.foreground,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  dropdown: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget - spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowText: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  moreHint: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
