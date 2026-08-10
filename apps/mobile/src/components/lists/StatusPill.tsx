// Rounded-full status badge: a leading dot plus a tiny uppercase label.
//
// Mirrors dw-time-web/src/features/tasks/components/task-list-item/
// task-status-badge.tsx (`rounded-full border bg-* px-2.5 py-0.5 font-semibold
// uppercase tracking-wider`) and the status dot that sits beside the title in
// task-header.tsx:16-21 / goal-item.tsx:67-73 — merged into one component
// here because on a phone-width row the dot and the word always travel
// together, and splitting them just costs a wrapper.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing, typography } from "@/theme/tokens";

import { TONES, type Tone } from "./tones";

export interface StatusPillProps {
  label: string;
  tone?: Tone;
  /** Leading dot — on by default; goal/task rows rely on it for scanability. */
  showDot?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StatusPill({ label, tone = "muted", showDot = true, style }: StatusPillProps) {
  const toneStyle = TONES[tone];

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: toneStyle.background, borderColor: toneStyle.border },
        style,
      ]}
    >
      {showDot ? <View style={[styles.dot, { backgroundColor: toneStyle.accent }]} /> : null}
      <Text style={[styles.label, { color: toneStyle.foreground }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    alignSelf: "flex-start",
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.full,
    borderWidth: 1,
    backgroundColor: colors.secondary,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...typography.label,
  },
});
