// Spinner-and-caption state, used where a skeleton doesn't fit — a full
// screen taking over while a document opens, or a short blocking wait whose
// final shape isn't known well enough to fake with a skeleton.
//
// Mirrors web's `loading.tsx`, which wraps the brand spinner in a centred
// box; here the brand moment is a ring drawn in the app's yellow behind the
// platform ActivityIndicator's own animation, so the wait still looks like
// GoalSlot rather than like a bare OS spinner on a white page.
//
// Rule of thumb for callers: if you know the shape of what's loading, use
// Skeleton (it preserves layout and feels faster). Reach for LoadingState
// only when you don't.

import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing, typography } from "@/theme/tokens";

export interface LoadingStateProps {
  message?: string;
  fullScreen?: boolean;
  /** Spinner scale. `lg` (default) is the full-screen wait; `sm` is an inline wait inside a row or card. */
  size?: "sm" | "lg";
  style?: StyleProp<ViewStyle>;
}

const HALO_SIZE = { sm: 40, lg: 64 } as const;

export function LoadingState({ message, fullScreen, size = "lg", style }: LoadingStateProps) {
  const halo = HALO_SIZE[size];

  return (
    <View
      style={[styles.container, fullScreen && styles.fullScreen, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? "Loading"}
    >
      {/* A soft brand ring standing in for web's GoalSlotSpinner — the
          platform indicator alone reads as "the OS is busy", not as the
          product doing something. */}
      <View style={[styles.halo, { width: halo, height: halo, borderRadius: radii.pill }]}>
        <ActivityIndicator size={size === "lg" ? "large" : "small"} color={colors.primaryPressed} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xxl,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  halo: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryMuted, // yellow-50, per stat-card.tsx's brand ring
    borderWidth: 1,
    borderColor: colors.primaryBorder, // yellow-200
  },
  message: {
    ...typography.body,
    fontWeight: "500",
    color: colors.mutedForeground,
    textAlign: "center",
  },
});
