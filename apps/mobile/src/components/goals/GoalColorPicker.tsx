// The goal's identity-colour picker.
//
// Replaces the eight literal hexes EditGoalSheet used to declare inline. Its
// comment there claimed no shared palette existed — that stopped being true
// when src/components/lists/swatches.ts was lifted out of categories.tsx,
// whose own header says it exists so screens "contain zero literal colors"
// and so the same user-chosen palette is offered wherever an entity colour is
// picked. Goals shipping a different eight meant a category and a goal tinted
// "orange" were two different oranges.
//
// Geometry and interaction mirror app/(app)/categories.tsx's SwatchPicker
// (its `swatchTarget` / `swatch` pair): a full 44pt press target around a
// 30pt dot, because a bare 30-32pt swatch with an 8pt gutter is under the
// minimum touch target and neighbours get hit instead. The check mark goes
// INSIDE the selected dot rather than being a ring around it — a ring
// disappears against same-hue neighbours.

import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { DEFAULT_SWATCH, PRESET_COLORS, prefersDarkTextOn, safeColor, withAlpha } from "@/components/lists";
import { colors, minTouchTarget, radii, spacing } from "@/theme/tokens";

/**
 * Human names for the shared palette, so a screen reader announces "Orange"
 * instead of spelling out a hex code one character at a time — which is what
 * the previous `Set goal color to ${option}` label did.
 *
 * Typed as a total map over PRESET_COLORS, so these are not free-floating
 * chrome values: they are provably the palette's own entries, and reordering,
 * adding or recolouring a swatch in lists/swatches.ts fails the typecheck here
 * until it is named. The table would still be better living beside the hexes
 * it names; that module is owned elsewhere this pass (flagged in the handover).
 */
type PresetColor = (typeof PRESET_COLORS)[number];

const SWATCH_NAMES: Record<PresetColor, string> = {
  "#EF4444": "Red",
  "#F97316": "Orange",
  "#F59E0B": "Amber",
  "#22C55E": "Green",
  "#0EA5E9": "Sky",
  "#6366F1": "Indigo",
  "#A855F7": "Purple",
  "#EC4899": "Pink",
};

function swatchName(color: string): string {
  return (SWATCH_NAMES as Record<string, string>)[color.toUpperCase()] ?? "Custom color";
}

export interface GoalColorPickerProps {
  /** Currently selected colour. Falls back to the palette's first entry. */
  value: string;
  onChange: (color: string) => void;
}

export function GoalColorPicker({ value, onChange }: GoalColorPickerProps) {
  const selected = safeColor(value, DEFAULT_SWATCH);

  // Goals created before this palette (quick-add stamps its own placeholder
  // grey, and the previous edit sheet had a different eight) carry a colour
  // that isn't in PRESET_COLORS. Showing it first keeps the picker honest —
  // otherwise the goal's real colour reads as "nothing selected" and simply
  // opening the sheet looks like it lost the value.
  const isPreset = (PRESET_COLORS as readonly string[]).includes(selected);
  const options = isPreset ? PRESET_COLORS : [selected, ...PRESET_COLORS];

  return (
    <View style={styles.row}>
      {options.map((option) => {
        const isSelected = option === selected;
        return (
          <Pressable
            key={option}
            style={[styles.target, isSelected && { backgroundColor: withAlpha(option, 0.18, colors.secondary) }]}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityLabel={`Goal color: ${swatchName(option)}`}
            accessibilityState={{ selected: isSelected }}
          >
            <View style={[styles.swatch, { backgroundColor: option }]}>
              {isSelected ? (
                // Mid-tone swatches (amber, green) fail against white, so the
                // mark's colour comes from the WCAG luminance helper the list
                // primitives already use rather than a fixed white.
                <Icon
                  name="check"
                  size={16}
                  color={prefersDarkTextOn(option) ? colors.foreground : colors.white}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  target: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
