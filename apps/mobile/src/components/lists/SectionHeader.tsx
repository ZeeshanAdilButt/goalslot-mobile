// Group header for a sectioned list: small uppercase label, count pill,
// optional trailing action.
//
// Mirrors two web patterns that are the same idea at different sizes:
//   - dw-time-web/src/features/tasks/components/task-list.tsx:55-77 — status
//     group header with a `rounded-full` count badge on the right, and the
//     DONE group visually demoted (`bg-gray-50 opacity-75`).
//   - dw-time-web/src/features/notes/components/notes-sidebar.tsx:847 —
//     "Favorites" / "All Notes" as `text-xs font-bold uppercase
//     tracking-wider text-muted-foreground`.
// The web wraps its task headers in their own card; here the label sits
// directly on the page background, which is the native list-section idiom
// and stops a screen of section cards from reading as nested boxes.

import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radii, spacing, typography } from "@/theme/tokens";

import { TONES, type Tone } from "./tones";

export interface SectionHeaderProps {
  label: string;
  /** Rendered as a pill on the right; omit for a bare label. */
  count?: number;
  /** Colors the leading rule and the count pill — e.g. a task status tone. */
  tone?: Tone;
  /** DONE-style groups recede without disappearing (web: `opacity-75`). */
  dimmed?: boolean;
  /** Trailing control, e.g. an "Add" button on Categories. */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ label, count, tone = "muted", dimmed, action, style }: SectionHeaderProps) {
  const toneStyle = TONES[tone];

  return (
    <View style={[styles.container, dimmed && styles.dimmed, style]}>
      <View style={[styles.rule, { backgroundColor: toneStyle.accent }]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {typeof count === "number" ? (
        <View style={[styles.countPill, { backgroundColor: toneStyle.background, borderColor: toneStyle.border }]}>
          <Text style={[styles.countText, { color: toneStyle.foreground }]}>{count}</Text>
        </View>
      ) : null}
      <View style={styles.spacer} />
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  dimmed: {
    opacity: 0.75,
  },
  rule: {
    width: 3,
    height: 14,
    borderRadius: radii.full,
  },
  label: {
    ...typography.h2,
    color: colors.mutedForeground,
  },
  countPill: {
    minWidth: 22,
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 1,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    ...typography.label,
  },
  spacer: {
    flex: 1,
  },
});
