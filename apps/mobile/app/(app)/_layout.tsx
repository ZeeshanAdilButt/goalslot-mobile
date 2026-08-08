import { Redirect, Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";

import { useAuth } from "@/providers/auth-provider";
import { colors } from "@/theme/tokens";

// Simple text glyphs instead of an icon library dependency (none is
// installed, and this task can't add one) — sized/weighted to read clearly
// at tab-bar scale and tinted via `color` so the focused/unfocused states
// from `tabBarActiveTintColor`/`tabBarInactiveTintColor` apply automatically.
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{glyph}</Text>;
}

export default function AppLayout() {
  const { status } = useAuth();

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
  // removing the route itself — they're reached via a Settings link off
  // Today's header, and Settings links onward to all three. Because they're
  // still Tabs.Screen entries rather than a separate stack, the five visible
  // tab buttons remain on screen the whole time, so navigating to any of
  // them is always one tap away — no dead end, no back button needed.
  // Today is the landing tab (index) per the product brief. Each screen
  // owns its own data-fetching/skeleton/empty states — this layout is
  // routing only.
  return (
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
  );
}
