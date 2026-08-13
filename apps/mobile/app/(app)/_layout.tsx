import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Tabs, usePathname, useRouter } from "expo-router";

import { Icon } from "@/components/ui/Icon";
import { ScheduleRemindersSync } from "@/components/schedule";
import { useAuth } from "@/providers/auth-provider";
import { AppDrawer } from "@/components/navigation/AppDrawer";
import type { DrawerHref } from "@/components/navigation/DrawerContent";
import { VoiceTabButton } from "@/components/voice/VoiceTabButton";
import { GlobalTrackingBanner } from "@/components/timer/GlobalTrackingBanner";
import { useMessagingLiveUpdates } from "@/hooks/useMessagingLiveUpdates";
import { useTimerStore } from "@/lib/timer-store";
import { syncWidgets } from "@/widgets/widget-sync";
import { colors, radii, shadows, spacing } from "@/theme/tokens";

export default function AppLayout() {
  const { status } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  // How much room to reserve above <Tabs/> for the tracking banner. Kept as
  // measured state (via GlobalTrackingBanner's onLayout) rather than a
  // guessed constant, so it stays correct under font scaling/a11y text
  // sizes and needs no hand tuning if the banner's own content ever changes
  // height. Zero (the default) means every screen's content starts exactly
  // where it always has.
  const [bannerHeight, setBannerHeight] = useState(0);

  // One socket for the whole authenticated app, so an incoming message
  // updates the conversation list from anywhere — not only while a Messages
  // screen is mounted. Handles background/foreground and reconnect; a no-op
  // when messaging isn't configured for this build. See the hook for why the
  // socket is dropped on background rather than held across it.
  //
  // Sits with the other unconditional hooks, above the redirect below — the
  // same rule the comment there spells out: `status` can flip to
  // 'unauthenticated' while this layout is mounted, and a hook after an early
  // return would break the hook order on that render.
  useMessagingLiveUpdates(status === "authenticated");

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

  // Keeps the home-screen widget in step with the app on BOTH platforms —
  // see src/widgets/widget-sync.ts for why the two need different machinery
  // behind one call. Three triggers:
  //
  //  1. mount — this layout only mounts once authenticated, so it doubles as
  //     "just signed in / just opened the app".
  //  2. foreground — picks up anything that changed while backgrounded.
  //  3. timer transitions — the important one. Neither platform notices a
  //     session starting on its own: Android would wait for the next
  //     `updatePeriodMillis` tick (30 min) and iOS for the next foreground,
  //     so without this a running timer simply doesn't appear on the home
  //     screen. Keyed on the fields the widget actually renders, so an
  //     unrelated store write doesn't cause a redraw.
  useEffect(() => {
    void syncWidgets();

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") {
          void syncWidgets();
        }
      },
    );

    const unsubscribeTimer = useTimerStore.subscribe((state, previous) => {
      if (
        state.status !== previous.status ||
        state.taskId !== previous.taskId ||
        state.goalId !== previous.goalId
      ) {
        void syncWidgets();
      }
    });

    return () => {
      appStateSubscription.remove();
      unsubscribeTimer();
    };
  }, []);

  // No live session — bounce to login. `status` is 'authenticated' |
  // 'unauthenticated' by the time this layout can render at all, since the
  // root layout (app/_layout.tsx) shows a full-screen LoadingState and holds
  // back the <Slot/> until `loadUser()` resolves out of 'loading'.
  if (status === "unauthenticated") {
    return <Redirect href="/login" />;
  }

  // Five slots on the bar — more than that is unreadable at phone width —
  // and the middle one is the voice mic rather than a screen: Today,
  // Schedule, [mic], Tasks, Timer. The other routes stay registered but off
  // the bar via `href: null`, and every one of them is reachable from the
  // slide-out drawer opened by the hamburger below.
  //
  // GOALS CAME OFF THE BAR to make room, and that is a real trade, not an
  // oversight. A raised centre control has to be the geometric centre or it
  // reads as a sixth tab someone bolted on, and five slots means one of the
  // existing five moves. Goals is the one that survives the move best: it is
  // the longest-horizon surface of the five (the others are all "today" or
  // "this week"), Today already renders goal progress and links into it, the
  // Timer attaches sessions to it, and it keeps a top-level row in the
  // drawer under Plan. Schedule, Tasks and Timer are all daily-use screens
  // where a second tap would be felt every day.
  //
  // The drawer exists because relying on a link buried in Settings was a real
  // discoverability failure: "I can't see notes. There is no way for me to
  // easily go through all the different areas. Should have been the side task
  // bar sidebar." See AppDrawer.tsx for why it's a hand-built overlay rather
  // than expo-router's own Drawer navigator.
  return (
    <View style={styles.root}>
      {/* Renders nothing. Owns re-arming every schedule alarm for the whole
          signed-in session, so they survive a sign-in's notification sweep
          and edits made outside the Schedule tab. See the component. */}
      <ScheduleRemindersSync />
      {/* paddingTop reserves exactly the tracking banner's own footprint
          (see bannerHeight above) so it pushes every screen's content down
          instead of painting over it — the banner used to be a pure overlay,
          which covered a screen's own top-of-page content (e.g. Schedule's
          "PLAN YOUR WEEK" heading) whenever a session was running. Zero when
          idle, so this is a no-op the vast majority of the time. */}
      <View style={{ flex: 1, paddingTop: bannerHeight }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primaryDark,
            tabBarInactiveTintColor: colors.mutedForeground,
            tabBarStyle: {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              // The voice mic is drawn with a negative top margin so it breaks
              // the bar's top line. Without this it is clipped flat against it
              // and stops reading as raised at all.
              overflow: "visible",
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: "600",
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Today",
              tabBarIcon: ({ color, size }) => (
                <Icon name="today" color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="schedule"
            options={{
              title: "Schedule",
              tabBarIcon: ({ color, size }) => (
                <Icon name="schedule" color={color} size={size} />
              ),
            }}
          />
          {/* The mic. `tabBarButton` replaces the whole tab item, which is what
            lets the control break the bar's top line — see VoiceTabButton.
            It stays a real route so a screen reader announces it as a tab
            and the back gesture behaves normally. */}
          <Tabs.Screen
            name="voice"
            options={{
              title: "Voice",
              tabBarButton: (props) => <VoiceTabButton {...props} />,
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              title: "Tasks",
              tabBarIcon: ({ color, size }) => (
                <Icon name="tasks" color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="timer"
            options={{
              title: "Timer",
              tabBarIcon: ({ color, size }) => (
                <Icon name="timer" color={color} size={size} />
              ),
            }}
          />
          {/* Off the bar to make room for the mic (see the note above), still a
            first-class row in the drawer's Plan group. */}
          <Tabs.Screen name="goals" options={{ title: "Goals", href: null }} />
          <Tabs.Screen name="coach" options={{ title: "Coach", href: null }} />
          <Tabs.Screen
            name="reports"
            options={{ title: "Reports", href: null }}
          />
          <Tabs.Screen
            name="categories"
            options={{ title: "Categories", href: null }}
          />
          <Tabs.Screen
            name="journal"
            options={{ title: "Journal", href: null }}
          />
          <Tabs.Screen name="notes" options={{ title: "Notes", href: null }} />
          {/* The note editor is a route, not a tab: hiding the tab bar while
            it's focused makes it read as a full-screen push. */}
          <Tabs.Screen
            name="note/[id]"
            options={{ href: null, tabBarStyle: { display: "none" } }}
          />
          {/* Messaging, same shape as Notes: a list screen plus a detail route
            that presents as a full-screen push. Both stay registered even
            when the service isn't configured — expo-router routes off the
            files on disk, so unregistering them here would leave two screens
            reachable by URL with no options applied. The drawer entry is what
            actually gates discovery (see DrawerContent), and both screens
            degrade to a clear "not available" state rather than crashing. */}
          <Tabs.Screen
            name="messages"
            options={{ title: "Messages", href: null }}
          />
          <Tabs.Screen
            name="message/[id]"
            options={{ href: null, tabBarStyle: { display: "none" } }}
          />
          <Tabs.Screen
            name="settings"
            options={{ title: "Settings", href: null }}
          />
        </Tabs>
      </View>

      {/* Renders nothing while idle; a slim tap-through-to-Timer pill while a
          session is running or paused, docked below the safe-area top on
          every tab. Painted as an absolute overlay (paint order: after
          <Tabs/>, so it draws above each tab's own content) purely so its
          own drop shadow can render over the content below it — the space
          it visually occupies is real, though: `bannerHeight` above pads
          <Tabs/> by the banner's own measured footprint, so this never
          actually covers anything, it just needs overlay paint order to
          cast its shadow correctly. Reserves room on its right so it never
          runs under the hamburger below. */}
      <GlobalTrackingBanner onContentHeightChange={setBannerHeight} />

      {/* Floating hamburger — the affordance that opens the drawer. Every
          screen here renders `headerShown: false` and draws its own in-screen
          header, so there's no shared header bar to dock a menu button into.
          Top-right keeps it clear of each screen's own title text, and the
          SafeAreaView inset keeps it below the status bar/notch. */}
      <SafeAreaView
        style={styles.hamburgerSafeArea}
        edges={["top", "right"]}
        pointerEvents="box-none"
      >
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

      <AppDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        pathname={pathname}
        onNavigate={navigateFromDrawer}
      />
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
