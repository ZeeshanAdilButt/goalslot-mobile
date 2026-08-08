import { createContext, useContext, useMemo, type ReactNode } from "react";
import * as Notifications from "expo-notifications";

import { createNoopCapabilities, type Capabilities } from "@goalslot/shared";

import { createExpoNotificationCapability } from "@/lib/notifications";

const CapabilitiesContext = createContext<Capabilities | null>(null);

// Runs once at module load, before the first provider mounts. Required by
// expo-notifications so a notification that arrives while the app is in the
// foreground is actually presented instead of silently dropped — without a
// handler registered, the library's documented default is not to show it.
// This lives here (rather than app/_layout.tsx) because it's part of wiring
// up the notifications capability, not general app bootstrap.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  // Real alarm/voice implementations land later (Phase 3+ per
  // dw-time-mobile/DECISIONS.md); notifications are real now, backed by
  // expo-notifications. This is the one seam the rest of the app reaches
  // through instead of touching a platform API directly.
  const capabilities = useMemo(
    () => ({
      ...createNoopCapabilities(),
      notifications: createExpoNotificationCapability(),
    }),
    [],
  );

  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): Capabilities {
  const capabilities = useContext(CapabilitiesContext);
  if (!capabilities) {
    throw new Error("useCapabilities must be used within a CapabilitiesProvider");
  }
  return capabilities;
}
