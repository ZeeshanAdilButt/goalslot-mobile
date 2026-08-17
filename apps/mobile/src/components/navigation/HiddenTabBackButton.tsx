// Back affordance for screens registered as hidden Tabs.Screens (`href: null`
// in app/(app)/_layout.tsx). A hidden tab keeps its own independent
// back-history, separate from whichever tab the user actually came from, so
// neither the in-app UI nor the OS hardware/gesture back button resolves to
// where the user expects — both land on the tab navigator's default (Today)
// instead. See note/[id].tsx and notification-settings.tsx for the first two
// screens this was fixed on; this centralizes the row markup and the
// hardware-back wiring those two hand-rolled, now that three more screens
// need the identical pattern. Each screen still documents its own destination
// choice and accepted limitation inline — that reasoning is screen-specific
// and does not belong here.

import { useCallback } from "react";
import { BackHandler, Pressable, StyleSheet, Text } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";

import { colors, radii, spacing, typography } from "@/theme/tokens";

/**
 * Registers hardwareBackPress -> router.replace(destination) while the host
 * screen is focused.
 *
 * Call sites pass `hiddenTabBackDestination("<their own route name>")` rather
 * than a literal Href — the destinations all live in one table in
 * lib/hidden-tab-routes.ts, which is what hidden-tab-routes.test.ts checks
 * against the `href: null` registrations in _layout.tsx. Ad-hoc literals per
 * call site are how `message/[id]` came to ship with no handler at all while
 * its immediate neighbours had one, with nobody able to see the difference.
 *
 * Note this is UNCONDITIONAL by design: it always replaces, and never
 * consults `router.canGoBack()` or calls `router.back()`. A hidden tab has no
 * back stack to pop — `router.back()` was tried here first and was
 * unreliable, which is why note/[id] hand-rolled a replace in the first
 * place. Both entry paths (an in-app push and a cold notification deep link)
 * therefore behave identically, which is exactly what makes the destination
 * worth getting right rather than leaving to the navigator's default.
 *
 * `onBeforeLeave` runs immediately before navigating — the note editor uses
 * it to flush an unsaved draft, which was the only thing keeping that screen
 * on its own hand-rolled copy of this after the hook existed.
 */
export function useHiddenTabBackHandler(destination: Href, options: { onBeforeLeave?: () => void } = {}) {
  const { onBeforeLeave } = options;
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        onBeforeLeave?.();
        router.replace(destination);
        return true;
      });
      return () => subscription.remove();
    }, [destination, onBeforeLeave]),
  );
}

export function HiddenTabBackButton({ label, destination }: { label: string; destination: Href }) {
  return (
    <Pressable
      onPress={() => router.replace(destination)}
      hitSlop={12}
      style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
    >
      <Text style={styles.backButtonText}>‹ {label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.control,
  },
  backButtonPressed: {
    backgroundColor: colors.secondary,
  },
  backButtonText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
});
