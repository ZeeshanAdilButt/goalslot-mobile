import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Tabs, usePathname, useRouter } from "expo-router";

import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/providers/auth-provider";
import { AppDrawer } from "@/components/navigation/AppDrawer";
import type { DrawerHref } from "@/components/navigation/DrawerContent";
import { colors, radii, shadows, spacing } from "@/theme/tokens";

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

  // Five tabs on the bar (Today/Schedule/Goals/Tasks/Timer) — more than that
  // is unreadable at phone width. The other five routes stay registered but
  // off the bar via `href: null`, and every one of them is reachable from the
  // slide-out drawer opened by the hamburger below.
  //
  // The drawer exists because relying on a link buried in Settings was a real
  // discoverability failure: "I can't see notes. There is no way for me to
  // easily go through all the different areas. Should have been the side task
  // bar sidebar." See AppDrawer.tsx for why it's a hand-built overlay rather
  // than expo-router's own Drawer navigator.
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
          options={{ title: "Today", tabBarIcon: ({ color, size }) => <Icon name="today" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: "Schedule",
            tabBarIcon: ({ color, size }) => <Icon name="schedule" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="goals"
          options={{ title: "Goals", tabBarIcon: ({ color, size }) => <Icon name="goals" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="tasks"
          options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <Icon name="tasks" color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="timer"
          options={{ title: "Timer", tabBarIcon: ({ color, size }) => <Icon name="timer" color={color} size={size} /> }}
        />
        <Tabs.Screen name="coach" options={{ title: "Coach", href: null }} />
        <Tabs.Screen name="reports" options={{ title: "Reports", href: null }} />
        <Tabs.Screen name="categories" options={{ title: "Categories", href: null }} />
        <Tabs.Screen name="journal" options={{ title: "Journal", href: null }} />
        <Tabs.Screen name="notes" options={{ title: "Notes", href: null }} />
        {/* The note editor is a route, not a tab: hiding the tab bar while
            it's focused makes it read as a full-screen push. */}
        <Tabs.Screen name="note/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", href: null }} />
      </Tabs>

      {/* Floating hamburger — the affordance that opens the drawer. Every
          screen here renders `headerShown: false` and draws its own in-screen
          header, so there's no shared header bar to dock a menu button into.
          Top-right keeps it clear of each screen's own title text, and the
          SafeAreaView inset keeps it below the status bar/notch. */}
      <SafeAreaView style={styles.hamburgerSafeArea} edges={["top", "right"]} pointerEvents="box-none">
        <Pressable
          onPress={openDrawer}
          style={styles.hamburgerButton}
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          hitSlop={8}
        >
          <Icon name="menu" color={colors.foreground} size={20} />
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
});
