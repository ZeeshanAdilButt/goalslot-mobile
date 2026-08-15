import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, Tabs, usePathname, useRouter } from "expo-router";

import { Icon } from "@/components/ui/Icon";
import { ScheduleRemindersSync } from "@/components/schedule";
import { useAuth } from "@/providers/auth-provider";
import { AppDrawer } from "@/components/navigation/AppDrawer";
import type { DrawerHref } from "@/components/navigation/DrawerContent";
import { VoiceTabButton } from "@/components/voice/VoiceTabButton";
import { GlobalTrackingBanner } from "@/components/timer/GlobalTrackingBanner";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import type { SearchHref } from "@/components/search/search-index";
import { useMessagingLiveUpdates } from "@/hooks/useMessagingLiveUpdates";
import { useTimerStore } from "@/lib/timer-store";
import { syncWidgets } from "@/widgets/widget-sync";
import { colors, radii, shadows, spacing } from "@/theme/tokens";

/**
 * Floor for the tab bar's bottom clearance above the system nav bar/gesture
 * pill, used as `Math.max(insets.bottom, MIN_BOTTOM_CLEARANCE)` — see the
 * `insets` comment below for why this exists at all. 16dp is comfortably
 * inside every real Android gesture-nav/3-button inset this app has actually
 * measured, so it only ever kicks in when `insets.bottom` itself is
 * suspiciously low/zero, not on a device where the reported value is already
 * legitimate.
 */
const MIN_BOTTOM_CLEARANCE = 16;

export default function AppLayout() {
  const { status } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Top search bar's own open state — see SearchOverlay.tsx for why it's a
  // plain overlay (not a <Modal>) and why it's mounted below.
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  // How much room to reserve above <Tabs/> for the tracking banner. Kept as
  // measured state (via GlobalTrackingBanner's onLayout) rather than a
  // guessed constant, so it stays correct under font scaling/a11y text
  // sizes and needs no hand tuning if the banner's own content ever changes
  // height. Zero (the default) means every screen's content starts exactly
  // where it always has.
  const [bannerHeight, setBannerHeight] = useState(0);

  // The tab bar composes its own bottom padding from this value below
  // (see tabBarStyle.paddingBottom) instead of trusting the library's
  // automatic `paddingBottom: insets.bottom` — on at least one real device
  // this session (Samsung Galaxy S22 Ultra, gesture nav, edge-to-edge
  // enabled) that automatic value read as 0, leaving the entire tab bar
  // flush against the screen edge with no clearance at all, so the
  // system's own gesture-nav pill drew directly on top of every tab
  // icon — not just Voice's raised orb overflowing by a few dp (a
  // different, already-fixed bug), the whole row. `Math.max(insets.bottom,
  // MIN_BOTTOM_CLEARANCE)` is a defensive floor: it changes nothing on a
  // device correctly reporting a real inset (the real value already
  // exceeds the floor), and guarantees real clearance on one that isn't.
  const insets = useSafeAreaInsets();

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
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const navigateFromSearch = useCallback(
    (href: SearchHref) => {
      setSearchOpen(false);
      router.push(href);
    },
    [router],
  );

  // This layout re-renders on every tab switch (usePathname changes),
  // drawer/search open-close, and timer transition (GlobalTrackingBanner's
  // onLayout -> setBannerHeight) — a fresh object literal here every render
  // means <Tabs> can never shallow-bail on unchanged options, so it
  // re-resolves the whole tab bar's chrome (all 5 icon closures, label
  // styles, bar height/padding) on renders that have nothing to do with the
  // bar itself. Only insets.bottom actually varies; everything else below is
  // a static theme token.
  const tabsScreenOptions = useMemo(
    () => ({
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
        overflow: "visible" as const,
        // The library's own default row height (49dp, a fixed UIKit-style
        // constant applied on both platforms) is exactly tall enough for
        // a plain icon+label pair, but VoiceTabButton's raised orb (its
        // label sits below 36dp of orb instead of a normal ~24dp icon)
        // overflows it by a few dp. `overflow: visible` above lets that
        // spill past the row's top line on purpose, but at the *bottom*
        // it was spilling into the safe-area inset padding below the
        // row instead — invisible on devices that reserve real gesture-
        // nav inset space, but merging the "Voice" label straight into
        // the Android system bar on devices/nav-modes where that inset
        // reads as zero or unreliable. Explicitly sizing the row itself
        // (rather than relying on inset padding to happen to cover the
        // gap) fixes it for every device, insets or not.
        height: 57,
        // Bottom clearance above the system nav bar/gesture pill, taken
        // over from the library's own automatic `paddingBottom:
        // insets.bottom` (this object is the last style merged into the
        // bar, so it wins). See the `MIN_BOTTOM_CLEARANCE` comment above
        // `insets` for why this can't just be `insets.bottom` on its own.
        paddingBottom: Math.max(insets.bottom, MIN_BOTTOM_CLEARANCE),
      },
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: "600" as const,
      },
    }),
    [insets.bottom],
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
        <Tabs screenOptions={tabsScreenOptions}>
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
          {/* Mentees: same "pushed, not tabbed" shape as Messages just above —
              a list screen plus a detail route that hides the tab bar. See
              DrawerContent for the entry point. */}
          <Tabs.Screen name="mentees" options={{ title: "Mentees", href: null }} />
          <Tabs.Screen
            name="mentee/[id]"
            options={{ href: null, tabBarStyle: { display: "none" } }}
          />
          <Tabs.Screen
            name="settings"
            options={{ title: "Settings", href: null }}
          />
          {/* Pushed from Settings' Notifications row once permission is
              granted (app/(app)/settings.tsx) — not reachable from the
              drawer, same as note/[id] and message/[id]. */}
          <Tabs.Screen
            name="notification-settings"
            options={{ title: "Notifications", href: null }}
          />
        </Tabs>
      </View>

      {/* Mounted BEFORE <GlobalTrackingBanner/> and the hamburger row below on
          purpose — later siblings paint over earlier ones (the same rule
          tracking-banner-store.ts's header documents), so this order is what
          keeps the tracking pill and the hamburger always visible on top of
          the search overlay rather than the reverse. See SearchOverlay.tsx. */}
      <SearchOverlay open={searchOpen} onClose={closeSearch} onNavigate={navigateFromSearch} />

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
          SafeAreaView inset keeps it below the status bar/notch.

          The search trigger stacks directly BELOW it (same column, same
          right margin) rather than beside it: every screen's own header
          (ScreenHeader.tsx's HAMBURGER_CLEARANCE, and the same-shaped
          per-screen constants in index.tsx/reports.tsx) and
          GlobalTrackingBanner's own marginRight already reserve exactly
          enough horizontal clearance for ONE 40pt button in this corner, not
          two side by side — widening that clearance means touching those
          other files too, and GlobalTrackingBanner.tsx is the tap-through
          pill's own implementation, off-limits while it's being edited
          elsewhere. Stacking vertically reuses the same reserved column
          those files already protect, so nothing else needs to change. */}
      <SafeAreaView
        style={styles.hamburgerSafeArea}
        edges={["top", "right"]}
        pointerEvents="box-none"
      >
        <View style={styles.headerButtonColumn}>
          <Pressable
            onPress={openDrawer}
            style={styles.hamburgerButton}
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            hitSlop={8}
          >
            <Icon name="menu" color={colors.foreground} size={20} />
          </Pressable>
          <Pressable
            onPress={openSearch}
            style={styles.searchTriggerButton}
            accessibilityRole="button"
            accessibilityLabel="Search"
            hitSlop={8}
          >
            <Icon name="search" color={colors.foreground} size={20} />
          </Pressable>
        </View>
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
  headerButtonColumn: {
    alignItems: "flex-end",
    gap: spacing.sm,
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
  searchTriggerButton: {
    width: 40,
    height: 40,
    marginRight: spacing.lg,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    ...shadows.fab,
  },
});
