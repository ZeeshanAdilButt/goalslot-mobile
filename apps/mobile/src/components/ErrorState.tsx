// The failure counterpart to EmptyState, and deliberately built from the
// same parts in the same order (illustration -> headline -> supporting line
// -> action) so a screen that fails looks like the same product as a screen
// that's merely empty. Only two things change: the tone is `danger` instead
// of neutral, and the primary action is a retry.
//
// The illustration is intentionally quieter than EmptyState's — no dashed
// rings, no brand specks. An error is not a moment to decorate; the ring
// treatment here is the same `IconBadge` used everywhere else, tinted red
// (web's `rose-50 / rose-500` family, badge.tsx:16), and that's it.

import type { ReactNode } from "react";
import { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { Button } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";
import { IconBadge } from "@/components/ui/IconBadge";
import { colors, motion, spacing, typography } from "@/theme/tokens";

export interface ErrorStateProps {
  message: string;
  /**
   * Optional bold headline shown above `message` — defaults to a generic
   * "Something went wrong" so every existing caller (which only ever passed
   * `message`, e.g. "Couldn't load goals.") gets a clear headline +
   * supporting-copy layout for free, matching dw-time-web's error
   * presentation, without any call site needing to change.
   */
  title?: string;
  onRetry?: () => void;
  /** Label for the retry button. Defaults to "Try again". */
  retryLabel?: string;
  /** Illustration glyph. Defaults to an alert triangle. */
  iconName?: IconName;
  /** Tightens the composition for an error inside a card or section rather than a whole screen. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Anything extra below the retry action — a support link, a technical detail toggle. */
  footer?: ReactNode;
}

export function ErrorState({
  message,
  title = "Something went wrong",
  onRetry,
  retryLabel = "Try again",
  iconName = "alert",
  compact = false,
  style,
  footer,
}: ErrorStateProps) {
  // Same hand-rolled entrance as EmptyState — see that file for why this
  // isn't Reanimated's `entering=` layout animation.
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: motion.duration.slow, easing: Easing.out(Easing.cubic) });
  }, [enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 12 }],
  }));

  return (
    <Animated.View style={[styles.container, compact && styles.containerCompact, enterStyle, style]}>
      <IconBadge
        name={iconName}
        tone="danger"
        size={compact ? "lg" : "xl"}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>

      {onRetry ? (
        <Button
          label={retryLabel}
          onPress={onRetry}
          // Secondary, not destructive: the red belongs to the illustration
          // that reports the problem, not to the button that fixes it — a red
          // button reads as "this action is dangerous".
          variant="secondary"
          icon="refresh"
          accessibilityLabel={retryLabel}
          style={styles.retry}
        />
      ) : null}

      {footer}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    gap: spacing.xl,
  },
  containerCompact: {
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  copy: {
    alignItems: "center",
    gap: spacing.sm,
    maxWidth: 320,
  },
  title: {
    ...typography.headline,
    color: colors.foreground,
    textAlign: "center",
  },
  message: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  retry: {
    marginTop: spacing.xs,
  },
});
