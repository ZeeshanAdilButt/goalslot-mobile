// Navigation tile for the Today screen's "Jump back in" grid.
//
// Direct port of dw-time-web's src/features/dashboard/components/
// dashboard-schedule-cta.tsx — the tinted icon square, the bold title, the
// muted one-line "Plan your week" subtitle, and the trailing arrow are all
// that component's anatomy. Web only ships one of these (Schedule); on a
// phone the same pattern earns its keep four times over, because the tab bar
// only holds five destinations and the rest of the app lives behind a
// hamburger most users never open.
//
// Placed low on the Today screen on purpose: these are the tiles a thumb can
// actually reach without a hand-shuffle.

import { StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/Icon";
import { PressableScale } from "@/components/today/PressableScale";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

export type QuickActionTone = "brand" | "neutral";

export interface QuickActionCardProps {
  title: string;
  subtitle: string;
  icon: IconName;
  tone?: QuickActionTone;
  accessibilityLabel: string;
  onPress: () => void;
}

const TILE_SIZE = 36;

export function QuickActionCard({
  title,
  subtitle,
  icon,
  tone = "neutral",
  accessibilityLabel,
  onPress,
}: QuickActionCardProps) {
  const brand = tone === "brand";

  return (
    <PressableScale
      style={[styles.card, brand && styles.cardBrand]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.topRow}>
        <View style={[styles.tile, brand ? styles.tileBrand : styles.tileNeutral]}>
          <Icon name={icon} size={18} color={brand ? colors.primaryForeground : colors.foreground} />
        </View>
        <Icon name="chevron" size={16} color={colors.mutedForeground} />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xxs,
    ...shadows.card,
  },
  cardBrand: {
    // Matches the web CTA's `border-yellow-200 bg-yellow-50` treatment — the
    // one tile in the grid that gets to be tinted, so it reads as the
    // recommended next step rather than as four equal options. `primaryMuted`
    // /`primaryBorder` ARE that yellow-50/yellow-200 pair; the previous
    // `warningMuted` fill was the theme's warning tint standing in for it.
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primaryBorder,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  tileNeutral: {
    backgroundColor: colors.secondary,
  },
  tileBrand: {
    backgroundColor: colors.primary,
  },
  title: {
    ...typography.title,
    fontSize: 15,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
});
