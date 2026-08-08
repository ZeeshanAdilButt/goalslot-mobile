import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Tabs, usePathname, useRouter } from "expo-router";

import { useAuth } from "@/providers/auth-provider";
import { AppDrawer } from "@/components/navigation/AppDrawer";
import type { DrawerHref } from "@/components/navigation/DrawerContent";
import { colors, radii, shadows, spacing } from "@/theme/tokens";

// Simple text glyphs instead of an icon library dependency (none is
// installed, and this task can't add one) — sized/weighted to read clearly
// at tab-bar scale and tinted via `color` so the focused/unfocused states
// from `tabBarActiveTintColor`/`tabBarInactiveTintColor` apply automatically.
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{glyph}</Text>;
}

export default function AppLayout() {
  const { status } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Hooks above this point must all run unconditionally on every render —
  // `status` can flip from 'authenticated' to 'unauthenticated' (logout)
  // while this component is already mounted, so the redirect below has to
  // come after every hook call, not before.
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const navigateFromDrawer = useCallback(
    (href: DrawerHref) => {
      setDrawerOpen(false);
      router.push(href);
    },
    [router],
  );

  // No live session — bounce to login. `status` is 'authenticated' |
  // 'unauthenticated' by the time this layout can render at all, since the
  // root layout (app/_layout.tsx) shows a full-screen LoadingState and holds
  // back the <Slot/> until `loadUser()` resolves out of 'loading'.
  if (status === "unauthenticated") {
    return <Redirect href="/login" />;
  }

  // Only the five v1 tabs (Today/Schedule/Goals/Tasks/Timer) sit on the tab
  // bar — nine tabs is unreadable on a phone-width bar. Reports/Categories/
  // Journal (added after v1 shipped — DECISIONS.md lists these as cut from
  // v1, but later requests brought back lightweight versions) and Settings
  // (fixes the "no UI path to logout" gap found post-v1) stay fully routable
  // via `href: null`, which removes a screen from the tab bar without
  // removing the route itself. Because they're still Tabs.Screen entries
  // rather than a separate stack, the five visible tab buttons remain on
  // screen the whole time, so navigating to any of them is always one tap
  // away — no dead end, no back button needed.
  //
  // Discoverability for the other four used to rely entirely on a link
  // buried in Settings — direct user feedback ("I can't see notes. There is
  // no way for me to easily go through all the different areas. Should have
  // been the side task bar sidebar.") flagged that as a real gap. The
  // <AppDrawer> below is the fix: every one of the nine screens gets a
  // labeled row in a slide-out sidebar, opened from the hamburger button
  // that floats above the tab bar on every screen. See AppDrawer.tsx for why
  // it's a hand-built overlay rather than expo-router's own `Drawer`
  // navigator (short version: the standard nested-navigator pattern would
  // require moving the five tab screen files into a new route-group
  // directory, and three of those files are being actively edited by other
  // agents on sibling branches right now).
  //
  // Today is the landing tab (index) per the product brief. Each screen
  // owns its own data-fetching/skeleton/empty states — this layout is
  // routing only.
  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primaryDark,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            borderTopWidth: 1,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Today", tabBarIcon: ({ color }) => <TabIcon glyph="☀" color={color} /> }}
        />
        <Tabs.Screen
          name="schedule"
          options={{ title: "Schedule", tabBarIcon: ({ color }) => <TabIcon glyph="▤" color={color} /> }}
        />
        <Tabs.Screen
          name="goals"
          options={{ title: "Goals", tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }}
        />
        <Tabs.Screen
          name="tasks"
          options={{ title: "Tasks", tabBarIcon: ({ color }) => <TabIcon glyph="✓" color={color} /> }}
        />
        <Tabs.Screen
          name="timer"
          options={{ title: "Timer", tabBarIcon: ({ color }) => <TabIcon glyph="◷" color={color} /> }}
        />
        <Tabs.Screen name="reports" options={{ title: "Reports", href: null }} />
        <Tabs.Screen name="categories" options={{ title: "Categories", href: null }} />
        <Tabs.Screen name="journal" options={{ title: "Journal", href: null }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", href: null }} />
      </Tabs>

      {/* Floating hamburger — the obvious "open the sidebar" affordance the
          drawer needs. Every screen under this layout renders
          `headerShown: false` and draws its own in-screen header (see e.g.
          settings.tsx's `styles.header`), so there's no single shared header
          bar left to dock a menu button into without editing all nine
          screen files, which this task explicitly can't do. A floating
          button positioned here, above the Tabs navigator, reaches every
          screen with a one-line change in this file instead. It sits
          top-right (not top-left, where every screen's own title text
          starts) so it never overlaps in-screen chrome, and its top offset
          respects the safe-area inset via SafeAreaView so it clears the
          status bar/notch on every device. */}
      <SafeAreaView style={styles.hamburgerSafeArea} edges={["top", "right"]} pointerEvents="box-none">
        <Pressable
          onPress={openDrawer}
          style={styles.hamburgerButton}
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          hitSlop={8}
        >
          <Text style={styles.hamburgerGlyph}>☰</Text>
        </Pressable>
      </SafeAreaView>

      <AppDrawer open={drawerOpen} onClose={closeDrawer} pathname={pathname} onNavigate={navigateFromDrawer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hamburgerSafeArea: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    marginTop: spacing.sm,
    marginRight: spacing.lg,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    ...shadows.fab,
  },
  hamburgerGlyph: {
    fontSize: 18,
    color: colors.foreground,
  },
});
