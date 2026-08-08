import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { GoalSlotLogo } from "@/components/brand/GoalSlotLogo";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  /**
   * Optional supporting copy shown under `message` in a smaller, muted
   * style — mirrors dw-time-web's EmptyState `title` + `description` split.
   * `message` alone already reads as a clear headline for every existing
   * caller, so this is opt-in rather than required.
   */
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const GLYPH_BADGE_SIZE = 64;

/**
 * Default illustration when a screen doesn't pass its own `icon` — the
 * GoalSlot mark, muted down to a soft outline rather than full brand
 * yellow, so it reads as "nothing here yet" instead of demanding attention.
 * Every current caller omits `icon`, so this is what actually shows up on
 * Today/Goals/Tasks/Schedule/Journal/Reports' empty states today.
 */
function DefaultGlyph() {
  return <GoalSlotLogo size={28} color={colors.mutedForeground} accessibilityLabel="" />;
}

export function EmptyState({ message, icon, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.glyphBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {icon ?? <DefaultGlyph />}
      </View>
      <Text style={styles.message}>{message}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xxl,
  },
  glyphBadge: {
    width: GLYPH_BADGE_SIZE,
    height: GLYPH_BADGE_SIZE,
    borderRadius: GLYPH_BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.title,
    color: colors.foreground,
    textAlign: "center",
  },
  description: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
  },
  actionButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  actionText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
