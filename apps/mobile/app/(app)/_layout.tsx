import { Redirect, Tabs } from "expo-router";

import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/providers/auth-provider";
import { colors } from "@/theme/tokens";

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
      <Tabs.Screen name="reports" options={{ title: "Reports", href: null }} />
      <Tabs.Screen name="categories" options={{ title: "Categories", href: null }} />
      <Tabs.Screen name="journal" options={{ title: "Journal", href: null }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", href: null }} />
    </Tabs>
  );
}
