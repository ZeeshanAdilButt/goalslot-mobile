import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Slot } from "expo-router";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { LoadingState } from "@/components/LoadingState";
import { asyncStoragePersister, queryClient } from "@/lib/query-client";
import { offlineSync } from "@/lib/offline";
import { CapabilitiesProvider } from "@/providers/capabilities-provider";
import { GrowthProvider } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";

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
