// Status/priority/category pill — a port of web's `badge.tsx` (and the
// dotted `live` treatment from `status-pill.tsx`). Web's base class is
// `inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px]
// font-semibold uppercase tracking-wider`, i.e. the `label` type role at
// `radii.full`, with a tint fill and a darker text of the same hue per
// variant (badge.tsx:8-20).
//
// Mobile bumps the smallest size's text from 10px to 11px (the `caption`
// role): 10px uppercase is legible on a desktop monitor at arm's length but
// sits below what's comfortable on a phone held at reading distance.

import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, iconSize, radii, spacing, typography } from "@/theme/tokens";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "brand"
  | "success"
  | "warning"
  | "destructive"
  | "outline"
  | "live";

export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  /** Badge text. `children` is accepted too, for callers that prefer the web component's shape. */
  label?: string;
  children?: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Leading status dot — status-pill.tsx's `dot` prop. */
  dot?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

interface BadgeSpec {
  background: string;
  border: string;
  foreground: string;
}

// badge.tsx:11-19. `brand` uses yellow-700 text rather than the raw brand
// yellow — #F2CC0D on a pale fill is unreadable, which is exactly why web
// switches to `text-yellow-700` there too.
const variantSpecs: Record<BadgeVariant, BadgeSpec> = {
  default: { background: colors.secondary, border: colors.border, foreground: colors.foreground },
  secondary: { background: colors.secondary, border: colors.border, foreground: colors.mutedForeground },
  brand: { background: colors.primaryMuted, border: colors.primaryBorder, foreground: colors.primaryText },
  success: { background: colors.successMuted, border: colors.successMuted, foreground: colors.success },
  warning: { background: colors.warningMuted, border: colors.warningMuted, foreground: colors.warning },
  destructive: { background: colors.destructiveMuted, border: colors.destructiveMuted, foreground: colors.destructive },
  outline: { background: colors.white, border: colors.border, foreground: colors.mutedForeground },
  live: { background: colors.successMuted, border: colors.successMuted, foreground: colors.success },
};

const DOT_SIZE = 6;

export function Badge({ label, children, variant = "default", size = "sm", dot, icon, style, textStyle }: BadgeProps) {
  const spec = variantSpecs[variant];
  const content = children ?? label;

  return (
    <View
      style={[
        styles.base,
        size === "md" ? styles.sizeMd : styles.sizeSm,
        { backgroundColor: spec.background, borderColor: spec.border },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: spec.foreground }]} /> : null}
      {icon ? <Icon name={icon} size={iconSize.xs} color={spec.foreground} /> : null}
      {typeof content === "string" ? (
        <Text style={[styles.label, size === "md" && styles.labelMd, { color: spec.foreground }, textStyle]}>
          {content}
        </Text>
      ) : (
        content
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start", // web's `inline-flex` — the pill hugs its text instead of filling the row
    gap: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  sizeSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs, // badge.tsx `py-0.5` (2px) — was an off-scale 3px
  },
  sizeMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs, // one real step up from `sizeSm`, was an off-scale 5px
  },
  label: {
    ...typography.caption, // 11/semibold/uppercase — see the header note on why not 10px
    letterSpacing: 0.6, // badge.tsx `tracking-wider`
  },
  labelMd: {
    fontSize: typography.bodySmall.fontSize,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
