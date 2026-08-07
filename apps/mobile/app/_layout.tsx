import { useEffect } from "react";
import { Slot } from "expo-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { LoadingState } from "@/components/LoadingState";
import { asyncStoragePersister, queryClient } from "@/lib/query-client";
import { offlineSync } from "@/lib/offline";
import { CapabilitiesProvider } from "@/providers/capabilities-provider";
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
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: asyncStoragePersister }}>
      <CapabilitiesProvider>
        <AppGate />
      </CapabilitiesProvider>
    </PersistQueryClientProvider>
  );
}
