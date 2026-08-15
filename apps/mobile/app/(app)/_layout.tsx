import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { AppState, Pressable, StyleSheet, View, type ColorValue } from "react-native";
import { SafeAreaView, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
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
 * pill, used inside `bottomClearance` below. Two earlier fixes (16, then 24
 * to match Android's documented gesture-nav standard) both aimed at this
 * number and neither stopped the report — see `bottomClearance` and
 * `TAB_BAR_CONTENT_HEIGHT` below for what those fixes actually missed. Left
 * at 24 here: nothing in this investigation found evidence the *number* was
 * ever the problem, only where it was being spent (see `TAB_BAR_CONTENT_HEIGHT`).
 */
const MIN_BOTTOM_CLEARANCE = 24;

/**
 * Height of the tab bar's own icon/label content row — separate from the
 * clearance reserved below it for the system nav bar. VERIFIED (not just
 * reasoned): react-native-safe-area-context's `useSafeAreaInsets()` is
 * backed by a live native-view listener (`NativeSafeAreaProvider`'s
 * `onInsetsChange`) that on some devices/timing never fires after its
 * initial mount value, per multiple independent reports against this exact
 * library/RN-version range (github.com/AppAndFlow/react-native-safe-area-context
 * issues #546/#552) — including one where `useSafeAreaInsets()` stayed 0
 * while `initialWindowMetrics` (a separate native *module constant*, read
 * directly off the window at bridge init rather than via that listener) had
 * the correct value the whole time. `bottomClearance` below now takes
 * whichever of the two is largest, which is a second, independently-sourced
 * reading rather than a bigger guess at the same one.
 *
 * REASONED BUT NOT DEVICE-VERIFIED: re-reading how that clearance was spent
 * turned up a second, likely-larger bug. The tab bar's `tabBarStyle.height`
 * used to be a flat `57` — a number picked (commit dcad29f) purely to give
 * VoiceTabButton's raised orb enough room, on the assumption that 57 was the
 * *content* row's height. It never was: the library's own default sizing is
 * `TABBAR_HEIGHT_UIKIT (49) + insets.bottom` — the inset is *additive* to a
 * fixed content height, not carved out of it — but our fixed `height: 57`
 * combined with `paddingBottom: bottomClearance` in the same box means every
 * dp handed to the clearance floor was a dp taken OUT of the icon/label/orb
 * row, not added below it. VoiceTabButton's own LIFT comment says that row
 * needs "~49-56dp" for the orb + caption to both fit; at the old
 * `height: 57, paddingBottom: 24` combination the actual content row was
 * `57 - 24 = 33dp` — well under that budget, which would show up as squeezed
 * or clipped icons/labels at the very bottom of the screen. Raising the
 * floor from 16 to 24 (commit 75cb788) shrank this same row by another 8dp,
 * which is consistent with the report surviving that fix rather than being
 * fixed by it. `height` below is now `TAB_BAR_CONTENT_HEIGHT + bottomClearance`
 * so the content row keeps this full budget regardless of how large the
 * clearance underneath it needs to be — matching the library's own additive
 * pattern instead of fighting it. Confirming this actually resolves the
 * on-device report still needs a real device; what's confirmed here is the
 * arithmetic bug itself, read directly from the merged style object.
 */
const TAB_BAR_CONTENT_HEIGHT = 57;

// Hoisted to module scope, sibling to `tabsScreenOptions` below: none of
// these close over component state (just the static `color`/`size` a tab
// bar hands its icon), so a fresh object per `AppLayout` render bought
// nothing but defeating <Tabs>'s ability to shallow-bail on renders that
// have nothing to do with the bar itself (see `tabsScreenOptions`'s comment
// for the render triggers). Module-level constants are stable for the life
// of the app, not just memoized against a dependency array.
function renderTodayIcon({ color, size }: { color: ColorValue; size: number }) {
  return <Icon name="today" color={color} size={size} />;
}
function renderScheduleIcon({ color, size }: { color: ColorValue; size: number }) {
  return <Icon name="schedule" color={color} size={size} />;
}
function renderTasksIcon({ color, size }: { color: ColorValue; size: number }) {
  return <Icon name="tasks" color={color} size={size} />;
}
function renderTimerIcon({ color, size }: { color: ColorValue; size: number }) {
  return <Icon name="timer" color={color} size={size} />;
}
function renderVoiceTabButton(props: ComponentProps<typeof VoiceTabButton>) {
  return <VoiceTabButton {...props} />;
}

const todayTabOptions = { title: "Today", tabBarIcon: renderTodayIcon };
const scheduleTabOptions = { title: "Schedule", tabBarIcon: renderScheduleIcon };
// The mic. `tabBarButton` replaces the whole tab item, which is what lets
// the control break the bar's top line — see VoiceTabButton. It stays a
// real route so a screen reader announces it as a tab and the back gesture
// behaves normally.
const voiceTabOptions = { title: "Voice", tabBarButton: renderVoiceTabButton };
const tasksTabOptions = { title: "Tasks", tabBarIcon: renderTasksIcon };
const timerTabOptions = { title: "Timer", tabBarIcon: renderTimerIcon };

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
  // (see `bottomClearance` and tabBarStyle.paddingBottom) instead of
  // trusting the library's automatic `paddingBottom: insets.bottom` — on at
  // least one real device this session (Samsung Galaxy S22 Ultra, gesture
  // nav, edge-to-edge enabled) that automatic value read as 0. See
  // `TAB_BAR_CONTENT_HEIGHT`'s comment for the two fixes this went through
  // and what the investigation into the third report actually found.
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

  // Two independently-sourced readings of the same physical quantity, taken
  // as `Math.max(...)` against the documented floor — see
  // `TAB_BAR_CONTENT_HEIGHT`'s comment for why `insets.bottom` alone has been
  // reported stuck at 0 on some devices/timing even on current library
  // versions, and why `initialWindowMetrics` is a genuinely different
  // reading rather than the same one re-asked. `initialWindowMetrics` is a
  // module-level constant (read once, off the native module, not through
  // React) so it's safe to reference directly here without adding it to the
  // dependency array below.
  const bottomClearance = Math.max(
    insets.bottom,
    initialWindowMetrics?.insets.bottom ?? 0,
    MIN_BOTTOM_CLEARANCE,
  );

  // This layout re-renders on every tab switch (usePathname changes),
  // drawer/search open-close, and timer transition (GlobalTrackingBanner's
  // onLayout -> setBannerHeight) — a fresh object literal here every render
  // means <Tabs> can never shallow-bail on unchanged options, so it
  // re-resolves the whole tab bar's chrome (all 5 icon closures, label
  // styles, bar height/padding) on renders that have nothing to do with the
  // bar itself. Only bottomClearance actually varies; everything else below
  // is a static theme token.
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
        // TAB_BAR_CONTENT_HEIGHT is the icon/label/orb row's own budget —
        // see its comment for why this used to be a flat `57` (which ate
        // into that same budget every time `bottomClearance` grew) and is
        // now added on top of the clearance instead, the same way the
        // library's own default sizing (`TABBAR_HEIGHT_UIKIT + insets.bottom`)
        // does it.
        height: TAB_BAR_CONTENT_HEIGHT + bottomClearance,
        // Bottom clearance above the system nav bar/gesture pill, taken
        // over from the library's own automatic `paddingBottom:
        // insets.bottom` (this object is the last style merged into the
        // bar, so it wins). See `TAB_BAR_CONTENT_HEIGHT`'s comment for why
        // this is `bottomClearance` rather than `insets.bottom` on its own.
        paddingBottom: bottomClearance,
      },
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: "600" as const,
      },
    }),
    [bottomClearance],
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
          <Tabs.Screen name="index" options={todayTabOptions} />
          <Tabs.Screen name="schedule" options={scheduleTabOptions} />
          <Tabs.Screen name="voice" options={voiceTabOptions} />
          <Tabs.Screen name="tasks" options={tasksTabOptions} />
          <Tabs.Screen name="timer" options={timerTabOptions} />
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
          <Tabs.Screen name="mentees" options={{ title: "Sharing", href: null }} />
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
