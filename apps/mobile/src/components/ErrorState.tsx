import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

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
}

const GLYPH_BADGE_SIZE = 64;

/** Small alert-circle mark, drawn with react-native-svg (already a dependency via GoalSlotLogo) rather than pulling in an icon library. */
function AlertGlyph() {
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={colors.destructive} strokeWidth={2} />
      <Line x1={12} y1={7.5} x2={12} y2={13} stroke={colors.destructive} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={16.5} r={1.15} fill={colors.destructive} />
    </Svg>
  );
}

export function ErrorState({ message, title = "Something went wrong", onRetry }: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.glyphBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <AlertGlyph />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
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
    gap: spacing.sm,
    padding: spacing.xxl,
  },
  glyphBadge: {
    width: GLYPH_BADGE_SIZE,
    height: GLYPH_BADGE_SIZE,
    borderRadius: GLYPH_BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.destructiveMuted,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.foreground,
    textAlign: "center",
  },
  message: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
  },
  retryButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
    marginTop: spacing.sm,
  },
  retryText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.destructive,
  },
});
