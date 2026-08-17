// The floating Messages button — web already has one
// (goal-slot-web's FloatingMessagesButton in its bottom-right dock); this is
// its mobile counterpart.
//
// PLACEMENT: BOTTOM-RIGHT, NOT A FOURTH BUTTON IN THE TOP-RIGHT COLUMN.
// That was a deliberate decision against the obvious option, for four
// reasons, all of them measurable in app/(app)/_layout.tsx:
//
//  1. The top-right column already stacks THREE 40pt buttons (menu, search,
//     bell) with 8pt gaps, occupying safeTop+8 → safeTop+144; each Pressable
//     adds hitSlop 8, so its live touch band ends around safeTop+152. A
//     fourth pushes that to ~safeTop+200 — another 48pt of right-edge real
//     estate claimed on EVERY screen.
//  2. That column's own comment records a real, shipped bug caused by
//     exactly this: its dead zone reached into messages.tsx's header action
//     row and ate the top slice of the "New message" button.
//     `pointerEvents="box-none"` fixed the container, but the buttons
//     themselves still paint and capture over whatever is beneath them, and
//     ScreenHeader's `action` row reserves no right gutter of its own.
//     Growing the column would re-open that class of bug on more screens —
//     at the very moment a "Mark all read" button is being added into that
//     same band.
//  3. Four stacked pills in one corner stops reading as chrome and starts
//     reading as a toolbar someone forgot to finish.
//  4. Web's own button lives in the BOTTOM-right dock. Docking here matches
//     it; adding to the top-right column would not.
//
// Not the tab bar either: the layout documents five slots with the mic as
// the geometric centre, and Goals was already sacrificed to get there. Not
// the Today quick-access rail either: that rail is four items wide by
// design and exists only on Today, whereas web's button is global.
//
// Presentation only, matching this folder's rule — the count and the
// navigation are passed in. See src/hooks/useUnreadMessagesCount.ts for what
// the number is and src/lib/messages-badge.ts for why it is unread
// CONVERSATIONS rather than notification rows.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, shadows, spacing, typography } from "@/theme/tokens";

export interface FloatingMessagesButtonProps {
  /** Unread CONVERSATIONS. 0 hides the badge; the button itself stays. */
  unreadCount: number;
  onPress: () => void;
}

export function FloatingMessagesButton({ unreadCount, onPress }: FloatingMessagesButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.button}
      accessibilityRole="button"
      // The count belongs in the accessible name: the visual badge alone
      // tells a screen-reader user nothing. Same rule the drawer's Messages
      // row and the bell already follow.
      accessibilityLabel={unreadCount > 0 ? `Messages, ${unreadCount} unread` : "Messages"}
      hitSlop={8}
    >
      <Icon name="messages" color={colors.foreground} size={20} />
      {unreadCount > 0 ? (
        <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    // A full 44pt target rather than the header column's 40: this one sits in
    // the thumb zone at the bottom of the screen, where it is actually
    // reached one-handed.
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    ...shadows.fab,
  },
  // Same brand-yellow-fill-with-dark-text treatment as the bell's badge and
  // the drawer's Messages badge — this reads as the app's one unread
  // convention, not a third invention.
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    color: colors.foreground,
  },
});
