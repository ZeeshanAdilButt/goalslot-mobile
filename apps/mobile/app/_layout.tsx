import { useEffect, useRef } from "react";
import { Linking } from "react-native";
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
import { getErrorMessage } from "@/lib/get-error-message";
import { runNotificationTap, shouldHandleNotificationTap } from "@/lib/notification-tap";
import { addPushTokenChangeListener } from "@/lib/notifications";
import { createPushRegistrationPort, syncPushRegistration } from "@/lib/push-registration";
import { showToast } from "@/lib/toast-store";
import { checkForUpdateAndReload } from "@/lib/updates";
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
  // shape, and src/lib/notification-tap.ts for the single dispatcher every
  // notification tap routes through — shared with the in-app notification
  // center so the two can't drift (in-app navigation is only one of its
  // outcomes; "open-url"/"check-for-update" are the others).
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  // The notification this app has already acted on. A ref, not state:
  // writing it must not itself trigger a render, and it only ever guards the
  // effect below. See shouldHandleNotificationTap for why it exists — without
  // it, any later auth transition re-runs this effect against the same stale
  // response and drags the user into an old conversation.
  const handledResponseId = useRef<string | null>(null);
  useEffect(() => {
    const responseId = lastNotificationResponse?.notification.request.identifier ?? null;
    if (
      !lastNotificationResponse ||
      !shouldHandleNotificationTap({
        status,
        isRestoring,
        responseId,
        handledId: handledResponseId.current,
      })
    ) {
      return;
    }
    handledResponseId.current = responseId;

    const data = lastNotificationResponse.notification.request.content.data;
    // Deferred by one commit, and this is load-bearing — do NOT "simplify" it
    // to a direct call.
    //
    // When `status` flips to 'authenticated' this effect and (auth)/_layout's
    // `<Redirect href="/" />` fire in the SAME commit. A `router.push` issued
    // there loses that race: the redirect lands second and overwrites it, so
    // a user who tapped a message notification while signed out finished on
    // Today instead of the conversation. Issuing the push one commit later —
    // after the auth redirect has settled — wins. Verified end to end against
    // this repo's expo-router with a react-test-renderer probe covering the
    // warm, signed-in-cold-start and signed-out-then-sign-in orderings.
    const timeout = setTimeout(() => {
      runNotificationTap(data, {
        // Built at runtime from a notification payload (see ROUTES.* in
        // deep-links.ts), so it can never be one of expo-router's statically
        // known literal paths — same `as Href` escape hatch index.tsx already
        // uses for its own dynamically-referenced routes.
        navigate: (href) => router.push(href as Href),
        openUrl: (url) => void Linking.openURL(url),
        // A release notification with no URL signals a JS-only OTA update —
        // check-fetch-reload right now rather than sending the user to
        // Settings to do it manually. Silent on "up to date"/"unavailable"
        // (nothing actionable for the user in either case from a background
        // tap); a real failure still surfaces, same as the manual Settings
        // row (app/(app)/settings.tsx) reusing this same helper.
        checkForUpdate: () => {
          void checkForUpdateAndReload(() => showToast("Downloading the latest update…", "success")).catch(
            (err: unknown) => showToast(getErrorMessage(err, "Couldn't check for an update."), "error"),
          );
        },
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [status, isRestoring, lastNotificationResponse]);

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
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: asyncStoragePersister,
          // A restore-time cache version, not a build number: bump this string
          // whenever a shipped bug is known to have written bad data into the
          // persisted cache, so every existing install discards its on-disk
          // snapshot once and rebuilds clean from the server, instead of
          // carrying the corruption forward across in-place updates forever.
          // This one covers the messages-query merge bug (see
          // packages/shared/src/queries/messaging.ts) that let a socket
          // reconnect loop resurrect and duplicate pending message bubbles —
          // by the time that landed, some installs had accumulated thousands
          // of zombie duplicates baked into their persisted cache, which no
          // amount of fixing the merge logic going forward removes on its own.
          buster: "2026-08-16-messaging-cache-corruption-fix",
        }}
      >
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
