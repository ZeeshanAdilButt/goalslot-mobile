import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, spacing, typography } from "@/theme/tokens";

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>Retry</Text>
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
    fontWeight: "500",
    color: colors.destructive,
    textAlign: "center",
  },
  retryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
  },
  retryText: {
    color: colors.destructive,
    fontWeight: "700",
  },
});
