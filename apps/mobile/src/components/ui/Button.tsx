// Shared button primitive. Variants and sizes are a 1:1 port of the web
// app's `button.tsx` cva definition (dw-time-web/src/components/ui/button.tsx:9-37)
// so the same word — "secondary", "destructive", "brand" — means the same
// thing on both platforms; the two mobile-only additions (spring press
// feedback, haptics) exist because web expresses affordance through hover,
// which touch does not have. See DESIGN.md "No hover states".
//
// Structure note: the caller's `style` stays on the outer <Pressable> (so
// layout props — margins, flex, width — behave exactly as they did before
// this component grew an animation layer), while all visual chrome lives on
// an inner surface that is what actually scales under a press. Animating the
// Pressable itself would have meant `Animated.createAnimatedComponent`,
// which does not accept Pressable's function-form `style` prop.

import { forwardRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { Icon, type IconName } from "@/components/ui/Icon";
import { hapticLight } from "@/lib/haptics";
import { colors, controlHeight, iconSize, motion, radii, shadows, spacing, typography } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "brand" | "outline" | "destructive";

/** Web's `sm` / `default` / `lg` (button.tsx:22-27), floored to touch-target sizes. */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "style" | "children" | "onPress"> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Height/padding/type scale. Defaults to `md`, which is the size this component always rendered before sizes existed. */
  size?: ButtonSize;
  /** Leading or trailing glyph, matching web's `[&_svg]:size-4` icon slot inside a button. */
  icon?: IconName;
  iconPosition?: "leading" | "trailing";
  /** Stretch to the container's full width — the default for a form's submit button. */
  fullWidth?: boolean;
  /** Light impact on press-in. On by default; pass `false` for buttons fired in rapid succession (e.g. a stepper). */
  haptic?: boolean;
  /** Extra styling for the label only, so callers don't have to re-declare the whole variant. */
  textStyle?: StyleProp<TextStyle>;
}

// All sizes share web's `rounded-lg`, which in THIS app's Tailwind config is
// 12px (`radii.lg`), not the 8px the name suggests — see DESIGN.md's radius
// note. Kept as a constant because the press-tint overlay has to repeat it.
const BUTTON_RADIUS = radii.lg;

export const Button = forwardRef<React.ComponentRef<typeof Pressable>, ButtonProps>(function Button(
  {
    label,
    variant = "primary",
    loading = false,
    disabled = false,
    onPress,
    style,
    accessibilityLabel,
    size = "md",
    icon,
    iconPosition = "leading",
    fullWidth = false,
    haptic = true,
    textStyle,
    onPressIn,
    onPressOut,
    ...rest
  },
  ref,
) {
  // Loading implies disabled — a mid-flight request shouldn't be
  // re-triggerable by a second tap. Callers only need to pass `loading`.
  const isDisabled = disabled || loading;

  const pressed = useSharedValue(0);

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(pressed.value === 1 ? motion.pressScale : 1, motion.spring),
      },
    ],
  }));

  // The pressed color is a separate opaque layer under the label rather than
  // an interpolated background, so `ghost`/`outline` (no background at rest)
  // get the same treatment as filled variants without needing a transparent
  // color token to interpolate from.
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: withTiming(pressed.value, { duration: motion.duration.fast }),
  }));

  const spec = variantSpecs[variant];
  const sizeSpec = sizeSpecs[size];
  const glyph = icon ? <Icon name={icon} size={sizeSpec.icon} color={spec.foreground} /> : null;

  return (
    <Pressable
      ref={ref}
      onPress={isDisabled ? undefined : onPress}
      onPressIn={(event) => {
        pressed.value = 1;
        if (haptic) {
          hapticLight();
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = 0;
        onPressOut?.(event);
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[fullWidth && styles.fullWidth, style]}
      {...rest}
    >
      <Animated.View
        style={[
          styles.surface,
          sizeSpec.container,
          spec.container,
          isDisabled && styles.disabled,
          surfaceStyle,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.pressTint, { backgroundColor: spec.pressedBackground }, overlayStyle]}
        />
        {loading ? (
          <ActivityIndicator color={spec.foreground} size="small" />
        ) : (
          <View style={styles.content}>
            {iconPosition === "leading" ? glyph : null}
            <Text
              style={[styles.label, sizeSpec.label, { color: spec.foreground }, textStyle]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {iconPosition === "trailing" ? glyph : null}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  surface: {
    borderRadius: BUTTON_RADIUS,
    alignItems: "center",
    justifyContent: "center",
    // Clipping is handled by matching the tint's radius rather than
    // `overflow: hidden`, which suppresses the iOS drop shadow.
  },
  pressTint: {
    // Written out rather than via `StyleSheet.absoluteFillObject`, which this
    // React Native version doesn't declare on the StyleSheet type.
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: BUTTON_RADIUS,
    opacity: 0,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm, // web button.tsx:9 `gap-2`
  },
  label: {
    fontWeight: typography.weight.semibold, // web button.tsx:9 `font-semibold`
    textAlign: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  disabled: {
    opacity: 0.5, // web button.tsx:9 `disabled:opacity-50`
  },
});

interface SizeSpec {
  container: ViewStyle;
  label: TextStyle;
  icon: number;
}

// Heights come from `controlHeight`, which is web's h-8/h-9/h-11 raised to
// clear the 44pt touch floor (see foundation.ts). Horizontal padding tracks
// web's px-3 / px-3.5 / px-5.
const sizeSpecs: Record<ButtonSize, SizeSpec> = {
  sm: {
    container: { minHeight: controlHeight.sm, paddingHorizontal: spacing.md },
    label: { fontSize: typography.size.xs }, // web `sm: text-xs`
    icon: iconSize.sm,
  },
  md: {
    container: { minHeight: controlHeight.md, paddingHorizontal: spacing.lg },
    label: { fontSize: typography.size.md },
    icon: iconSize.md,
  },
  lg: {
    container: { minHeight: controlHeight.lg, paddingHorizontal: spacing.xl },
    label: { fontSize: typography.size.lg }, // web `lg: text-base`, stepped up with the height
    icon: iconSize.md,
  },
};

interface VariantSpec {
  container: ViewStyle;
  foreground: string;
  /** Opaque layer faded in on press — the mobile stand-in for web's `hover:` color. */
  pressedBackground: string;
}

// Ported from web button.tsx:13-19. `primary` maps to web's `default`
// (zinc-900 / white) and is unchanged from this component's original
// behaviour; `brand` is the yellow CTA — note its foreground is
// `primaryForeground` (near-black), never white: #F2CC0D against white text
// is roughly 1.7:1 and unreadable.
const variantSpecs: Record<ButtonVariant, VariantSpec> = {
  primary: {
    container: { backgroundColor: colors.foreground, ...shadows.subtle }, // `bg-zinc-900 text-white shadow-sm`
    foreground: colors.white,
    pressedBackground: colors.foregroundPressed, // `hover:bg-zinc-800`
  },
  brand: {
    container: { backgroundColor: colors.primary, ...shadows.subtle }, // `bg-[#f2cc0d] text-zinc-900`
    foreground: colors.primaryForeground,
    pressedBackground: colors.primaryPressed, // `hover:bg-[#d9b307]`
  },
  secondary: {
    // `border border-zinc-200 bg-white text-zinc-900`
    container: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadows.subtle,
    },
    foreground: colors.foreground,
    pressedBackground: colors.secondary, // `hover:bg-zinc-50` (mobile takes the next step down for a visible touch response)
  },
  outline: {
    // `border border-zinc-200 bg-transparent`
    container: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
    foreground: colors.foreground,
    pressedBackground: colors.secondary, // `hover:bg-zinc-50`
  },
  ghost: {
    container: {}, // `text-zinc-700 hover:bg-zinc-100`
    foreground: colors.foreground,
    pressedBackground: colors.secondary,
  },
  destructive: {
    container: { backgroundColor: colors.destructive }, // `bg-rose-500 text-white`
    foreground: colors.destructiveForeground,
    pressedBackground: colors.destructivePressed, // `hover:bg-rose-600`
  },
};
