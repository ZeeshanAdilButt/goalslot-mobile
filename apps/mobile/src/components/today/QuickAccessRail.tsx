// A single row of compact icon shortcuts near the top of Today.
//
// Deliberately NOT another QuickActionCard grid. That component is a
// full-width-half card with a title, a subtitle and a chevron; four of them
// is two more rows of vertical budget than this screen has above the fold,
// and it would read as a duplicate of the "Jump back in" grid further down
// rather than as a faster path to the same places. Small round-ish badges
// with a one-word caption are visually distinct enough that the two don't
// look like the same control twice.
//
// The badge itself is IconBadge, not a new tinted square. IconBadge's own
// header says re-inlining it is the failure mode this app has already had
// four times over; `md` (40pt box) is the size used everywhere a badge is a
// tap target rather than list decoration.
//
// PressableScale (not a bare Pressable) because every tappable on Today
// uses it — the press-scale spring plus the light haptic is the only
// feedback a touch surface gets between tap and navigation.

import { StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/today/PressableScale";
import type { QuickAccessItem } from "@/components/today/quick-access";
import { IconBadge } from "@/components/ui/IconBadge";
import { colors, minTouchTarget, spacing, typography } from "@/theme/tokens";

export interface QuickAccessRailProps {
  items: readonly QuickAccessItem[];
  /**
   * Called with the tapped item's `href`. The screen owns navigation so this
   * component stays free of a router dependency (and stays renderable from a
   * test or a storybook-style harness later).
   */
  onSelect: (item: QuickAccessItem) => void;
}

export function QuickAccessRail({ items, onSelect }: QuickAccessRailProps) {
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <QuickAccessRailItem key={item.id} item={item} onSelect={onSelect} />
      ))}
    </View>
  );
}

interface QuickAccessRailItemProps {
  item: QuickAccessItem;
  onSelect: (item: QuickAccessItem) => void;
}

// Split out so each item can close over its own `item` in a stable handler
// instead of the parent minting four new arrow functions. Today re-renders
// once a minute (the `setNow` tick in app/(app)/index.tsx), so this is not
// hypothetical churn.
function QuickAccessRailItem({ item, onSelect }: QuickAccessRailItemProps) {
  return (
    <PressableScale
      style={styles.item}
      onPress={() => onSelect(item)}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
    >
      <IconBadge
        name={item.icon}
        size="md"
        shape="rounded"
        tone="neutral"
        // The caption underneath already says the same word, and the
        // Pressable above carries the real accessible name.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.label} numberOfLines={1}>
        {item.label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    // Matches journalWrap in app/(app)/index.tsx — same gutter as every
    // other full-bleed block on Today, so the badges line up with the cards
    // above and below them.
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  item: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: spacing.xs,
    // The badge is 40pt; the caption carries the rest of the height, but pin
    // the floor anyway so the row can never fall under the tap-target
    // minimum if the caption is ever dropped.
    minHeight: minTouchTarget,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
});
