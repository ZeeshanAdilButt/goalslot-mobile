import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { router, Slot, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { LoadingState } from "@/components/LoadingState";
import { asyncStoragePersister, queryClient } from "@/lib/query-client";
import { offlineSync } from "@/lib/offline";
import { initSentry } from "@/lib/sentry";
import { resolveNotificationRoute } from "@/lib/deep-links";
import { CapabilitiesProvider } from "@/providers/capabilities-provider";
import { GrowthProvider } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";

// Runs once at module load, before the first render — a no-op today since
// the DSN is still a placeholder (see src/lib/sentry.ts).
initSentry();

function AppGate() {
  const { status, loadUser } = useAuth();

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

  if (status === "loading") {
    return <LoadingState message="Loading GoalSlot..." fullScreen />;
  }

  // Auth/route guarding happens one level down, in the (auth) and (app)
  // group layouts — they each redirect based on `status`.
  return <Slot />;
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
