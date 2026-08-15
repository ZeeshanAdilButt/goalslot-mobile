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

/** Registers hardwareBackPress -> router.replace(destination) while the host screen is focused. */
export function useHiddenTabBackHandler(destination: Href) {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace(destination);
        return true;
      });
      return () => subscription.remove();
    }, [destination]),
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
