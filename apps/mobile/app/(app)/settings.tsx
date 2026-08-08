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
import { useFocusEffect } from "expo-router";

import { useCapabilities } from "@/providers/capabilities-provider";
import { useAnalytics } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";
import { useSettingsStore, type ThemePreference } from "@/lib/settings-store";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
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
    backgroundColor: "#FFFFFF",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    opacity: 0.5,
    marginBottom: 4,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1F2933",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  profileEmail: {
    fontSize: 13,
    color: "#64748B",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  rowLabel: {
    fontSize: 15,
    color: "#0F172A",
  },
  segmentedControl: {
    flexDirection: "row",
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#F1F5F9",
  },
  segmentButtonActive: {
    backgroundColor: "#1F2933",
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
  segmentLabelActive: {
    color: "#FFFFFF",
  },
  themeNote: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
  },
  logoutButton: {
    marginTop: 32,
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#FEE2E2",
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#B3261E",
  },
});
