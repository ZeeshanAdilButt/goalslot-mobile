// Shared button primitive — three variants (primary/secondary/ghost) plus a
// loading state. Built on `Pressable` rather than `TouchableOpacity` so we
// get `pressed` state for free without wiring up Animated ourselves.
//
// Deliberately kept to a single component instead of Button.Primary /
// Button.Secondary subcomponents — the variant prop is the whole API
// surface other screens need.

import { forwardRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, typography } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends Omit<PressableProps, "style" | "children" | "onPress"> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const Button = forwardRef<React.ComponentRef<typeof Pressable>, ButtonProps>(function Button(
  { label, variant = "primary", loading = false, disabled = false, onPress, style, accessibilityLabel, ...rest },
  ref,
) {
  // Loading implies disabled — a mid-flight request shouldn't be
  // re-triggerable by a second tap. Callers only need to pass `loading`.
  const isDisabled = disabled || loading;

  return (
    <Pressable
      ref={ref}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant].container,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].spinnerColor} size="small" />
      ) : (
        <Text style={[styles.label, variantStyles[variant].label]}>{label}</Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48, // comfortable touch target regardless of label length
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
});

// Variant-specific colors live together so adding/adjusting a variant means
// touching one object instead of hunting through the stylesheet.
const variantStyles: Record<
  ButtonVariant,
  { container: StyleProp<ViewStyle>; label: StyleProp<{ color: string }>; spinnerColor: string }
> = {
  primary: {
    container: { backgroundColor: colors.foreground },
    label: { color: colors.white },
    spinnerColor: colors.white,
  },
  secondary: {
    container: { backgroundColor: colors.secondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    label: { color: colors.foreground },
    spinnerColor: colors.foreground,
  },
  ghost: {
    container: { backgroundColor: "transparent" },
    label: { color: colors.foreground },
    spinnerColor: colors.foreground,
  },
};
