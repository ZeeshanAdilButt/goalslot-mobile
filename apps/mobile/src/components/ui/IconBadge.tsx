// The tinted icon container web uses whenever an icon needs to read as an
// object rather than as decoration: a circle/squircle with a tint fill, a
// matching 1px ring, and the icon in the darker text shade of the same hue.
// Two web sources, same pattern at two sizes:
//   - stat-card.tsx:44-51 — `h-7 w-7 rounded-full border` + the `accentRing`
//     map (`bg-yellow-50 text-yellow-700 border-yellow-200`, and the
//     emerald/rose/zinc equivalents).
//   - empty-state.tsx:22 — `h-12 w-12 rounded-full border border-zinc-200
//     bg-zinc-50 text-zinc-400` for the empty-state glyph.
//
// Extracted as its own primitive because it was about to be re-implemented
// inline in EmptyState, ErrorState, Card and the drawer — four slightly
// different circles is exactly how a design system stops looking designed.

import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, radii } from "@/theme/tokens";

export type IconBadgeTone = "brand" | "neutral" | "success" | "warning" | "danger" | "ink";

export type IconBadgeSize = "sm" | "md" | "lg" | "xl";

export interface IconBadgeProps
  // A badge is usually decoration next to text that already says the same
  // thing, so callers need a way to take it out of the accessibility tree.
  extends Pick<ViewProps, "accessibilityElementsHidden" | "importantForAccessibility"> {
  /** Icon to render inside. Omit and pass `children` to supply custom artwork. */
  name?: IconName;
  children?: ReactNode;
  tone?: IconBadgeTone;
  size?: IconBadgeSize;
  /** `rounded` is the squircle used on list rows; `circle` matches web's stat/empty-state rings. */
  shape?: "circle" | "rounded";
  style?: StyleProp<ViewStyle>;
}

interface ToneSpec {
  background: string;
  border: string;
  foreground: string;
}

const toneSpecs: Record<IconBadgeTone, ToneSpec> = {
  // stat-card.tsx accentRing.brand — `bg-yellow-50 text-yellow-700 border-yellow-200`.
  brand: { background: colors.primaryMuted, border: colors.primaryBorder, foreground: colors.primaryText },
  // accentRing.neutral — `bg-zinc-50 text-zinc-700 border-zinc-200`.
  neutral: { background: colors.secondary, border: colors.border, foreground: colors.mutedForeground },
  success: { background: colors.successMuted, border: colors.successMuted, foreground: colors.success },
  warning: { background: colors.warningMuted, border: colors.warningMuted, foreground: colors.warning },
  danger: { background: colors.destructiveMuted, border: colors.destructiveMuted, foreground: colors.destructive },
  // No web analogue — a solid dark chip for the one icon on a screen that
  // should read as the primary object (e.g. a drawer's app mark).
  ink: { background: colors.foreground, border: colors.foreground, foreground: colors.white },
};

const sizeSpecs: Record<IconBadgeSize, { box: number; glyph: number; radius: number }> = {
  sm: { box: 28, glyph: 14, radius: 8 }, // stat-card.tsx `h-7 w-7` + `size-3.5`
  md: { box: 40, glyph: 20, radius: 12 },
  lg: { box: 48, glyph: 22, radius: 14 }, // empty-state.tsx `h-12 w-12` + `size-5`
  xl: { box: 72, glyph: 32, radius: 22 }, // mobile-only: the empty-state glyph as artwork, not as a label
};

export function IconBadge({
  name,
  children,
  tone = "neutral",
  size = "md",
  shape = "circle",
  style,
  ...accessibility
}: IconBadgeProps) {
  const toneSpec = toneSpecs[tone];
  const sizeSpec = sizeSpecs[size];

  return (
    <View
      {...accessibility}
      style={[
        styles.base,
        {
          width: sizeSpec.box,
          height: sizeSpec.box,
          borderRadius: shape === "circle" ? radii.full : sizeSpec.radius,
          backgroundColor: toneSpec.background,
          borderColor: toneSpec.border,
        },
        style,
      ]}
    >
      {children ?? (name ? <Icon name={name} size={sizeSpec.glyph} color={toneSpec.foreground} /> : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});
