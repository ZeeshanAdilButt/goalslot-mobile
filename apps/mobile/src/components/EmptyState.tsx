import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, spacing, typography } from "@/theme/tokens";

export interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ message, icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon}
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.actionButton} onPress={onAction}>
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
    gap: spacing.md,
    padding: spacing.xxl,
  },
  message: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
    textAlign: "center",
  },
  actionButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  actionText: {
    color: colors.primaryForeground,
    fontWeight: "700",
  },
});
