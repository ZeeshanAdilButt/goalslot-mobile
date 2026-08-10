// Metadata chip: small icon + label in a tinted, hairline-bordered box.
//
// Port of dw-time-web/src/features/tasks/components/task-list-item/
// task-metadata.tsx — the row of `rounded-sm border-2 px-2 py-1 text-[11px]
// font-semibold uppercase` chips carrying category / linked goal / schedule
// block / due date. Two things it keeps from the web version:
//   - `accentColor`: the goal chip there is tinted from the goal's OWN color
//     (`borderColor: goal.color, backgroundColor: `${goal.color}18``), which
//     is why this takes a raw entity color rather than only a Tone.
//   - the squared `rounded-sm` corners, which is what visually separates a
//     metadata chip from a rounded-full StatusPill.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, radii, spacing, typography } from "@/theme/tokens";

import { safeColor, withAlpha } from "./color";
import { TONES, type Tone } from "./tones";

const ICON_SIZE = 12;

export interface MetaChipProps {
  label: string;
  icon?: IconName;
  tone?: Tone;
  /**
   * Entity color (goal.color / category.color / label.color). When present it
   * overrides the tone's surface — same precedence the web chip uses.
   */
  accentColor?: string | null;
  style?: StyleProp<ViewStyle>;
}

export function MetaChip({ label, icon, tone = "muted", accentColor, style }: MetaChipProps) {
  const toneStyle = TONES[tone];
  const accent = accentColor ? safeColor(accentColor, toneStyle.accent) : null;

  const background = accent ? withAlpha(accent, 0.12, toneStyle.background) : toneStyle.background;
  const border = accent ? withAlpha(accent, 0.42, toneStyle.border) : toneStyle.border;
  // Entity colors are user-picked and can be near-white or neon; text on the
  // 12%-tint surface stays foreground-dark for guaranteed contrast, and the
  // color shows through the border + icon instead.
  const foreground = accent ? colors.foreground : toneStyle.foreground;

  return (
    <View style={[styles.chip, { backgroundColor: background, borderColor: border }, style]}>
      {icon ? <Icon name={icon} size={ICON_SIZE} color={accent ?? toneStyle.foreground} /> : null}
      <Text style={[styles.label, { color: foreground }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 1,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    backgroundColor: colors.secondary,
  },
  label: {
    ...typography.caption,
    flexShrink: 1,
  },
});
