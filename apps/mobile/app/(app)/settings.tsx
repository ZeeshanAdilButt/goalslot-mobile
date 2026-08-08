// Settings tab: profile summary, logout, a notifications permission toggle,
// and a theme preference picker. This is a plain settings LIST (rows with
// labels + controls), not a design showcase — see DECISIONS.md's v1 screen
// list, which scopes Settings to exactly profile/logout/notifications/theme.
//
// Logout is the important one here: useAuth().logout() has existed since
// the auth provider was built, but nothing in the app called it — once a
// user logged in there was no way back out. This screen is the fix.

import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useFocusEffect } from "expo-router";

import { useCapabilities } from "@/providers/capabilities-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";
import { useSettingsStore, type ThemePreference } from "@/lib/settings-store";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// The three screens that were cut from the tab bar (see app/(app)/_layout.tsx)
// but still need a way in — Settings is that way in. Each is a plain
// Tabs.Screen route (href: null just hides it from the tab bar), so a
// normal Link/router navigation works exactly like any other route.
const MORE_LINKS: { href: "/reports" | "/categories" | "/journal"; label: string; description: string }[] = [
  { href: "/reports", label: "Reports", description: "Weekly stats and trends" },
  { href: "/categories", label: "Categories & labels", description: "Manage how you organize goals and tasks" },
  { href: "/journal", label: "Journal", description: "Your daily writing entries" },
];

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { notifications } = useCapabilities();
  const analytics = useAnalytics();

  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);

  // Local UI reflection of "did the permission request succeed" — there's
  // no persisted/queryable OS permission state exposed through the
  // NotificationCapability seam yet, so this is intentionally just a
  // best-effort mirror of the last requestPermission() result, not a source
  // of truth read back from the OS on every mount.
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "settings" } });
    }, [analytics]),
  );

  const handleNotificationsToggle = useCallback(
    async (value: boolean) => {
      if (!value) {
        // Turning off is just a local UI preference — there's no OS API to
        // revoke a permission that's already been granted, so this doesn't
        // call into the capability at all.
        setNotificationsEnabled(false);
        return;
      }
      const granted = await notifications.requestPermission();
      setNotificationsEnabled(granted);
    },
    [notifications],
  );

  const confirmLogout = useCallback(() => {
    // Destructive + irreversible from the user's point of view (they land
    // back on the login screen), so this needs a confirm step rather than
    // firing on a single accidental tap. No analytics event fires here —
    // "loggedOut" isn't part of the v1 AnalyticsEventMap (packages/shared/
    // src/growth/index.ts), which is deliberately scoped to the five
    // existing screens' events; adding one is out of scope for this screen.
    Alert.alert("Log out?", "You'll need to sign in again to access your schedule.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => void logout(),
      },
    ]);
  }, [logout]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{(user?.name || user?.email || "?").charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.name || "—"}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {user?.email || "—"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Enable notifications</Text>
          <Switch
            value={notificationsEnabled}
            onValueChange={(value) => void handleNotificationsToggle(value)}
            accessibilityRole="switch"
            accessibilityLabel="Enable notifications"
            accessibilityState={{ checked: notificationsEnabled }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Theme</Text>
        <View style={styles.segmentedControl}>
          {THEME_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.segmentButton, themePreference === option.value && styles.segmentButtonActive]}
              onPress={() => setThemePreference(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label} theme`}
              accessibilityState={{ selected: themePreference === option.value }}
            >
              <Text
                style={[styles.segmentLabel, themePreference === option.value && styles.segmentLabelActive]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.themeNote}>
          Theme switching isn't wired up across the app yet — your choice is saved and will take effect once
          full theme support ships.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>More</Text>
        <View style={styles.card}>
          {MORE_LINKS.map((link, index) => (
            <Link key={link.href} href={link.href} asChild>
              <Pressable
                style={[styles.moreRow, index < MORE_LINKS.length - 1 && styles.moreRowDivider]}
                accessibilityRole="link"
                accessibilityLabel={link.label}
              >
                <View style={styles.moreRowText}>
                  <Text style={styles.moreRowLabel}>{link.label}</Text>
                  <Text style={styles.moreRowDescription}>{link.description}</Text>
                </View>
                <Text style={styles.moreRowChevron}>›</Text>
              </Pressable>
            </Link>
          ))}
        </View>
      </View>

      <Pressable
        style={styles.logoutButton}
        onPress={confirmLogout}
        accessibilityRole="button"
        accessibilityLabel="Log out"
      >
        <Text style={styles.logoutButtonText}>Log out</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.foreground,
  },
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
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: colors.primaryForeground,
    fontSize: 18,
    fontWeight: "700",
  },
  profileText: {
    flex: 1,
    gap: spacing.xxs,
  },
  profileName: {
    ...typography.title,
    color: colors.foreground,
  },
  profileEmail: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  rowLabel: {
    ...typography.body,
    color: colors.foreground,
  },
  segmentedControl: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.md,
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentButtonActive: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  segmentLabelActive: {
    color: colors.white,
  },
  themeNote: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  moreRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  moreRowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  moreRowLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  moreRowDescription: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  moreRowChevron: {
    fontSize: 20,
    color: colors.mutedForeground,
  },
  logoutButton: {
    marginTop: spacing.xxxl,
    marginHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    backgroundColor: colors.destructiveMuted,
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.destructive,
  },
});
