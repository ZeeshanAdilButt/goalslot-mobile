import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/providers/auth-provider";

export default function AppLayout() {
  const { status } = useAuth();

  // No live session — bounce to login. `status` is 'authenticated' |
  // 'unauthenticated' by the time this layout can render at all, since the
  // root layout (app/_layout.tsx) shows a full-screen LoadingState and holds
  // back the <Slot/> until `loadUser()` resolves out of 'loading'.
  if (status === "unauthenticated") {
    return <Redirect href="/login" />;
  }

  // The five v1 tabs, plus Reports/Categories/Journal (added after v1
  // shipped — DECISIONS.md lists these as cut from v1, but later requests
  // brought back lightweight versions; see the corresponding screen files)
  // and Settings (fixes the "no UI path to logout" gap found post-v1).
  // Today is the landing tab (index) per the product brief. Each screen
  // owns its own data-fetching/skeleton/empty states — this layout is
  // routing only.
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="schedule" options={{ title: "Schedule" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
      <Tabs.Screen name="tasks" options={{ title: "Tasks" }} />
      <Tabs.Screen name="timer" options={{ title: "Timer" }} />
      <Tabs.Screen name="reports" options={{ title: "Reports" }} />
      <Tabs.Screen name="categories" options={{ title: "Categories" }} />
      <Tabs.Screen name="journal" options={{ title: "Journal" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
