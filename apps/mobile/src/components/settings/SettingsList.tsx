// The grouped-list primitives the Settings screen is built from: a section
// heading, one bordered card per section, and hairline-divided rows inside it.
//
// This is the platform "grouped list" convention, and it mirrors the sidebar
// card in dw-time-web/src/app/dashboard/settings/page.tsx:70-93 — a bordered
// container, `border-b border-zinc-100` between rows, `last:border-b-0`, and
// a leading icon on every row. Web puts eight of these rows in a sidebar and
// swaps a detail pane; a phone has no room for two panes, so the same rows
// become the screen and the detail opens as a sheet.
//
// Extracted rather than left inline because the Settings screen now has six
// sections: repeating the row's touch-target floor, divider rule and chevron
// logic six times is how one of them ends up 38pt tall.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

export interface SettingsSectionProps {
  /** Small uppercase heading above the card. Omit for an unlabelled group. */
  title?: string;
  /** One muted line under the card — the place for a caveat about the section. */
  footnote?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SettingsSection({ title, footnote, children, style }: SettingsSectionProps) {
  return (
    <View style={[styles.section, style]}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
    </View>
  );
}

export interface SettingsRowProps {
  label: string;
  /** Second line under the label. Wraps; not truncated. */
  description?: string;
  icon?: IconName;
  /**
   * Replaces the `icon` slot on the left with arbitrary content — an avatar,
   * a colour swatch. Leading rather than trailing because that is where the
   * eye starts on a row, and a face docked to the right edge reads as a
   * control.
   */
  leading?: ReactNode;
  /** Right-hand status text — a plan name, a permission state, a masked key. */
  value?: string;
  /** Anything richer than `value`: a Switch, a StatusPill, a spinner. */
  accessory?: ReactNode;
  onPress?: () => void;
  /** Announces as a link rather than a button. For rows that navigate. */
  isLink?: boolean;
  /**
   * Overrides the trailing chevron. It is drawn by default on any row that
   * has an `onPress` and no `accessory`, which is right for rows that open
   * something — and wrong for a row like "Log out", where a chevron promises
   * a screen that isn't coming.
   */
  chevron?: boolean;
  /** Rose label + rose icon. For rows that destroy something. */
  destructive?: boolean;
  disabled?: boolean;
  /** Hairline under this row. Pass `false` on a section's last row. */
  divider?: boolean;
  /** Overrides the derived label announced to a screen reader. */
  accessibilityLabel?: string;
  /** Read after the label — the place for "currently off", not for repeating `description`. */
  accessibilityHint?: string;
}

export function SettingsRow({
  label,
  description,
  icon,
  leading,
  value,
  accessory,
  onPress,
  isLink = false,
  chevron,
  destructive = false,
  disabled = false,
  divider = true,
  accessibilityLabel,
  accessibilityHint,
}: SettingsRowProps) {
  const tint = destructive ? colors.destructive : colors.foreground;
  const showChevron = chevron ?? (Boolean(onPress) && !accessory);

  // A Pressable is `accessible` by default, which collapses its children into
  // a single element — and once an `accessibilityLabel` is set, that label is
  // ALL a screen reader gets. Announcing a bare "Notifications, button" while
  // sighted users can see "On" and a line explaining why is the bug that
  // creates. So the default label is composed from everything the row
  // actually renders, and an explicit `accessibilityLabel` (for rows whose
  // visible text is too terse out of context) still wins.
  const composedLabel = [label, value, description].filter(Boolean).join(". ");

  const body = (
    <>
      {leading ??
        (icon ? (
          <Icon name={icon} size={18} color={destructive ? colors.destructive : colors.mutedForeground} />
        ) : null)}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {showChevron ? <Icon name="chevron" size={18} color={colors.mutedForegroundLight} /> : null}
    </>
  );

  // `minTouchTarget` is the floor, not the height — a row with a description
  // grows past it. Padding rather than a fixed height is what keeps a wrapped
  // two-line description from being clipped.
  const rowStyle = [styles.row, divider && styles.rowDivider, disabled && styles.rowDisabled];

  if (!onPress) {
    return <View style={rowStyle}>{body}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [...rowStyle, pressed && !disabled && styles.rowPressed]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={isLink ? "link" : "button"}
      accessibilityLabel={accessibilityLabel ?? composedLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.mutedForeground,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.card,
  },
  footnote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowLabel: {
    ...typography.body,
    fontWeight: "600",
  },
  rowDescription: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  rowValue: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    maxWidth: "40%",
    textAlign: "right",
  },
});
