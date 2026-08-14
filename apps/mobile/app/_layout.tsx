import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { router, Slot, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useIsRestoring } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { ConnectivityPill } from "@/components/ConnectivityPill";
import { LoadingState } from "@/components/LoadingState";
import { ToastHost } from "@/components/ToastHost";
import { asyncStoragePersister, queryClient } from "@/lib/query-client";
import { offlineSync } from "@/lib/offline";
import { initSentry } from "@/lib/sentry";
import { resolveNotificationRoute } from "@/lib/deep-links";
import { addPushTokenChangeListener } from "@/lib/notifications";
import { createPushRegistrationPort, syncPushRegistration } from "@/lib/push-registration";
import { CapabilitiesProvider } from "@/providers/capabilities-provider";
import { GrowthProvider } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";

// Runs once at module load, before the first render — a no-op today since
// the DSN is still a placeholder (see src/lib/sentry.ts).
initSentry();

function AppGate() {
  const { status, loadUser, user } = useAuth();

  // True while the persisted query cache is still being read back off
  // AsyncStorage. Without this the tree mounts first and the restore lands
  // second, so every screen runs its first render against an *empty* cache —
  // `isPending` is true, skeletons appear, and the data they were already
  // holding pops in a moment later. That's the "loaders when we've got data"
  // flash: the cache wasn't missing, just late.
  const isRestoring = useIsRestoring();

  // Runs once: checks secure-store for a token left over from a previous
  // launch and resolves it against the API, moving `status` out of
  // 'loading' either way.
  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  // Kicks off the initial outbox drain + subscribes to reconnect events.
  // `.init()` returns an unsubscribe function per the shared package's
  // OfflineSync contract.
  useEffect(() => {
    const unsubscribe = offlineSync.init();
    return unsubscribe;
  }, []);

  // Remote-push registration. Without this the server has no address for
  // this device: `reminder-dispatch` runs, finds no `kind:'EXPO'`
  // subscription rows for the user, and delivers nothing — which is the
  // whole reason "new message" pushes never arrived. See
  // src/lib/push-registration.ts.
  //
  // Runs once the user id is known, and again whenever it changes, so an
  // account switch re-points this handset at the account that is actually
  // signed in. It never prompts for permission (it registers only if
  // permission is already granted) and never throws, so it cannot delay or
  // break app start.
  const userId = user?.id;
  useEffect(() => {
    if (status !== "authenticated" || !userId) return;

    const port = createPushRegistrationPort();
    void syncPushRegistration(userId, port);

    // A push service can roll a token while the app is running, silently
    // invalidating the old one. Re-syncing on that event is what keeps the
    // registration self-healing instead of dying until the next cold start.
    return addPushTokenChangeListener(() => {
      void syncPushRegistration(userId, port);
    });
  }, [status, userId]);

  // Notification-tap routing. `useLastNotificationResponse` covers both
  // cold start (reads expo-notifications' native "last response" once on
  // mount, i.e. the app was launched by tapping a notification) and warm/
  // background taps (it also subscribes to live responses internally) —
  // one hook, one code path for both cases. This works against whatever
  // NotificationCapability implementation is scheduling notifications
  // (noop or real); it only depends on expo-notifications' response
  // shape. See src/lib/deep-links.ts for the expected `data` payload
  // shape and the route-resolution logic.
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    // Gated on `status`: while it's 'loading' this component renders
    // <LoadingState> below instead of <Slot/>, so there's no navigator
    // mounted yet for `router.push` to target. Re-running this effect once
    // `status` settles means a cold-start tap that arrives before auth
    // resolves still gets routed (to an auth-guarded screen if needed —
    // the (app) layout's own redirect-to-login takes it from there).
    if (status === "loading" || !lastNotificationResponse) {
      return;
    }
    const route = resolveNotificationRoute(lastNotificationResponse.notification.request.content.data);
    if (route) {
      // Built at runtime from a notification payload (see ROUTES.* in
      // deep-links.ts), so it can never be one of expo-router's statically
      // known literal paths — same `as Href` escape hatch index.tsx already
      // uses for its own dynamically-referenced routes.
      router.push(route as Href);
    }
  }, [status, lastNotificationResponse]);

  if (status === "loading" || isRestoring) {
    return <LoadingState message="Loading GoalSlot..." fullScreen />;
  }

  // Auth/route guarding happens one level down, in the (auth) and (app)
  // group layouts — they each redirect based on `status`.
  //
  // <ConnectivityPill/> and <ToastHost/> are mounted here — once, above
  // every route — rather than per-screen, so every screen (not just
  // messaging, which already had its own OfflineBanner) gets the same
  // "you're offline" / "N changes waiting to sync" pill and the same landing
  // spot for the sync engine's toasts, without every screen wiring it up
  // itself.
  return (
    <>
      <Slot />
      <ConnectivityPill />
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  return (
    // GestureHandlerRootView must wrap the whole tree — react-native-gesture-handler
    // (and @gorhom/bottom-sheet, which is built on top of it) needs it above
    // every gesture-consuming view, not just the ones that use it directly.
    // BottomSheetModalProvider sits inside it and above AppGate so any
    // screen can mount a BottomSheetModal (e.g. QuickAddSheet) without its
    // own local provider.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: asyncStoragePersister }}>
        <CapabilitiesProvider>
          <GrowthProvider>
            <BottomSheetModalProvider>
              <AppGate />
            </BottomSheetModalProvider>
          </GrowthProvider>
        </CapabilitiesProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
