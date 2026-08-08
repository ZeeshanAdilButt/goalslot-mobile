// Shared text input primitive — label above, error text below, and a
// focus-state border so the field gives visible feedback without relying on
// the OS's default focus ring (which several Android skins suppress).
//
// Forwards all standard TextInput props through so call sites can still set
// `keyboardType`, `secureTextEntry`, `textContentType`, etc. exactly as they
// did with the bare `<TextInput>` this replaces.

import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { colors, radii, spacing, typography } from "@/theme";

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, style, onFocus, onBlur, accessibilityLabel, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        style={[styles.input, focused && styles.inputFocused, !!error && styles.inputError, style]}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={accessibilityLabel ?? label}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.foreground,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typography.size.md,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  inputFocused: {
    borderColor: colors.primaryDark,
  },
  inputError: {
    borderColor: colors.destructive,
  },
  error: {
    fontSize: typography.size.xs,
    color: colors.destructive,
  },
});
