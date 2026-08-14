// Solid entity-color swatch — the category/label identity dot on a list row's
// left rail. (A sibling `IconBadge` component — same footprint, an icon
// instead of a solid color — used to live in this file too; it had no
// remaining callers and was removed. `@/components/ui/IconBadge` is the
// actively-used icon-badge component elsewhere in the app, a separate,
// unrelated implementation despite the shared name.)

import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "@/theme/tokens";

import { safeColor, withAlpha } from "./color";

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
  swatchRing: {
    alignItems: "center",
    justifyContent: "center",
  },
});
