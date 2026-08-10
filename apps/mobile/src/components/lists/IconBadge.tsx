// An icon inside a soft, tinted, rounded container.
//
// The web reaches for this shape in its empty states
// (dw-time-web/src/components/ui/empty-state.tsx, used by goals-list.tsx:35
// with a `<Target />`) and for the colored identity dot on a category row
// (features/categories/components/category-management.tsx:85 — an `h-8 w-8
// rounded-full` swatch filled with `category.color`). Both are the same
// component: a fixed square carrying either an icon or a solid entity color,
// which is what gives a list row a stable left rail to align titles against.

import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, radii } from "@/theme/tokens";

import { safeColor, withAlpha } from "./color";

export interface IconBadgeProps {
  name: IconName;
  size?: number;
  /** Entity color; the container is tinted from it and the glyph drawn in it. */
  color?: string | null;
  /** Fully rounded instead of a squircle — used for category/label swatches. */
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Glyph occupies ~46% of the container, the proportion the web's badges use. */
const GLYPH_RATIO = 0.46;

export function IconBadge({ name, size = 40, color, round = false, style }: IconBadgeProps) {
  const accent = safeColor(color, colors.mutedForeground);

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: round ? size / 2 : radii.lg,
          backgroundColor: withAlpha(accent, 0.14, colors.secondary),
          borderColor: withAlpha(accent, 0.28, colors.border),
        },
        style,
      ]}
    >
      <Icon name={name} size={Math.round(size * GLYPH_RATIO)} color={accent} />
    </View>
  );
}

/**
 * Solid entity-color swatch — the category/label identity dot. Kept beside
 * IconBadge because it's the same footprint and the two are used
 * interchangeably down a single list's left rail.
 */
export function ColorSwatch({ color, size = 40, style }: { color?: string | null; size?: number; style?: StyleProp<ViewStyle> }) {
  const fill = safeColor(color, colors.mutedForeground);
  return (
    <View
      style={[
        styles.swatchRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(fill, 0.16, colors.secondary),
        },
        style,
      ]}
    >
      <View
        style={{
          width: size * 0.55,
          height: size * 0.55,
          borderRadius: size,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  swatchRing: {
    alignItems: "center",
    justifyContent: "center",
  },
});
