// Surface primitive — the mobile port of web's `glass-card.tsx`: white fill,
// `rounded-xl` (16px = radii.xl), a hairline zinc-200 border, and the soft
// two-layer shadow that `shadows.card` approximates (glass-card.tsx:16).
//
// Two deliberate departures from that file, both from DESIGN.md:
//   - Web lifts the card on hover (`hover:-translate-y-0.5`). Touch has no
//     hover, and lifting a card under a finger reads as a rendering bug, so
//     a pressable card scales DOWN slightly instead.
//   - `accentColor` reproduces the 4px status bar web draws on a real list
//     row (`task-list-item.tsx:47` — `border-l-4`), which is the one card
//     variation the app actually uses often enough to belong in the
//     primitive rather than in each screen.
//
// The optional `title`/`subtitle`/`icon`/`trailing` header is a convenience
// for the row-shaped cards most screens render; passing only `children`
// gives a plain surface with nothing baked in.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Icon, type IconName } from "@/components/ui/Icon";
import { IconBadge, type IconBadgeTone } from "@/components/ui/IconBadge";
import { colors, iconSize, motion, radii, shadows, spacing, typography } from "@/theme/tokens";

export type CardVariant = "elevated" | "flat" | "outline";

export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Applied to the inner content box, i.e. inside the padding. */
  contentStyle?: StyleProp<ViewStyle>;
  /** `elevated` (default) matches web's glass-card; `flat` drops the shadow; `outline` drops the fill too. */
  variant?: CardVariant;
  padding?: CardPadding;
  /** Makes the whole card a control — adds the press spring and a button/link role. */
  onPress?: () => void;
  /** 4px leading status bar, as on web's task rows (`border-l-4`). */
  accentColor?: string;
  title?: string;
  subtitle?: string;
  icon?: IconName;
  iconTone?: IconBadgeTone;
  /** Rendered at the trailing edge of the header row — a badge, a count, a chevron. */
  trailing?: ReactNode;
  /** Shows a chevron at the trailing edge. Ignored when `trailing` is set. */
  showChevron?: boolean;
  accessibilityLabel?: string;
}

const paddingSpecs: Record<CardPadding, number> = {
  none: 0,
  sm: spacing.md,
  md: spacing.lg, // stat-card.tsx `p-4` — the compact card
  lg: spacing.xxl, // glass-card.tsx `padded` -> `p-6` — the content-heavy card
};

export function Card({
  children,
  style,
  contentStyle,
  variant = "elevated",
  padding = "md",
  onPress,
  accentColor,
  title,
  subtitle,
  icon,
  iconTone = "neutral",
  trailing,
  showChevron = false,
  accessibilityLabel,
}: CardProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(pressed.value === 1 ? motion.pressScale : 1, motion.spring) }],
  }));

  const hasHeader = Boolean(title || subtitle || icon || trailing || showChevron);

  // The clip layer carries the border/fill/radius and `overflow: hidden` (so
  // the accent bar can't escape the corner radius), while the shadow stays on
  // the outer surface — iOS maps `overflow: hidden` to `masksToBounds`, which
  // would clip the drop shadow off the same view.
  const body = (
    <View style={[styles.clip, variantStyles[variant]]}>
      {accentColor ? <View style={[styles.accent, { backgroundColor: accentColor }]} /> : null}
      <View style={[{ padding: paddingSpecs[padding] }, accentColor && styles.contentInsetForAccent, contentStyle]}>
        {hasHeader ? (
          <View style={[styles.header, children ? styles.headerSpaced : null]}>
            {icon ? <IconBadge name={icon} tone={iconTone} size="md" shape="rounded" /> : null}
            <View style={styles.headerText}>
              {title ? (
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {trailing ?? (showChevron ? <Icon name="chevron" size={iconSize.md} color={colors.mutedForegroundLight} /> : null)}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );

  const surfaceStyle = [styles.surface, variant === "elevated" && shadows.card, style];

  if (!onPress) {
    return <View style={surfaceStyle}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = 1;
      }}
      onPressOut={() => {
        pressed.value = 0;
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      <Animated.View style={[...surfaceStyle, animatedStyle]}>{body}</Animated.View>
    </Pressable>
  );
}

const ACCENT_WIDTH = 4; // task-list-item.tsx `border-l-4`

const styles = StyleSheet.create({
  surface: {
    borderRadius: radii.xl, // glass-card.tsx `rounded-xl` — also the shape Android's `elevation` shadow follows
  },
  clip: {
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    overflow: "hidden", // keeps the accent bar inside the corner radius
  },
  accent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: ACCENT_WIDTH,
  },
  contentInsetForAccent: {
    paddingLeft: spacing.lg + ACCENT_WIDTH,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerSpaced: {
    marginBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.title,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
});

// glass-card.tsx:16 — every variant keeps the hairline zinc-200 border; only
// the fill and the shadow (applied on the outer surface) differ.
const variantStyles: Record<CardVariant, ViewStyle> = {
  elevated: { borderWidth: 1, borderColor: colors.border },
  flat: { borderWidth: 1, borderColor: colors.border },
  outline: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
};
