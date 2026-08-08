// Shared text input primitive — label above, error text below, and a
// focus-state border so the field gives visible feedback without relying on
// the OS's default focus ring (which several Android skins suppress).
//
// Forwards all standard TextInput props through so call sites can still set
// `keyboardType`, `secureTextEntry`, `textContentType`, etc. exactly as they
// did with the bare `<TextInput>` this replaces.
//
// `secureToggle` layers a reveal/hide affordance on top of `secureTextEntry`
// — pass both to get a password field the user can unmask. No icon library
// is installed, so the toggle is a plain text button ("Show"/"Hide") rather
// than an eye icon.

import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { colors, radii, spacing, typography } from "@/theme";

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  /** Adds a "Show"/"Hide" toggle that flips `secureTextEntry` on and off. */
  secureToggle?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, style, onFocus, onBlur, accessibilityLabel, secureToggle, secureTextEntry, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const isSecure = secureToggle ? !revealed : secureTextEntry;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.inputWrapper}>
        <TextInput
          ref={ref}
          style={[
            styles.input,
            secureToggle && styles.inputWithToggle,
            focused && styles.inputFocused,
            !!error && styles.inputError,
            style,
          ]}
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel={accessibilityLabel ?? label}
          secureTextEntry={isSecure}
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
        {secureToggle ? (
          <Pressable
            onPress={() => setRevealed((prev) => !prev)}
            style={styles.toggle}
            hitSlop={{ top: spacing.sm, bottom: spacing.sm, left: spacing.sm, right: spacing.sm }}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
          >
            <Text style={styles.toggleLabel}>{revealed ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
      </View>
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
  inputWrapper: {
    justifyContent: "center",
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
  inputWithToggle: {
    // Room for the "Show"/"Hide" affordance so typed text never runs
    // underneath it.
    paddingRight: spacing.xxl + spacing.lg,
  },
  inputFocused: {
    borderColor: colors.primaryDark,
  },
  inputError: {
    borderColor: colors.destructive,
  },
  toggle: {
    position: "absolute",
    right: spacing.lg,
  },
  toggleLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.primaryDark,
  },
  error: {
    fontSize: typography.size.xs,
    color: colors.destructive,
  },
});
