import { createContext, useContext, useMemo, type ReactNode } from "react";
import * as Notifications from "expo-notifications";

import { createNoopCapabilities, type Capabilities } from "@goalslot/shared";

import { createExpoNotificationCapability } from "@/lib/notifications";
import { createSpeechRecognitionCapability } from "@/lib/speech-recognition";

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
  // Alarms are still the inert stand-in (Phase 3+ per DECISIONS.md).
  // Notifications and voice are real: expo-notifications and
  // expo-speech-recognition respectively. This is the one seam the rest of
  // the app reaches through instead of touching a platform API directly —
  // which is why the voice screens never import expo-speech-recognition,
  // and why the capability degrading to "unavailable" on a device with no
  // recognizer needs no handling anywhere but the UI that renders it.
  const capabilities = useMemo(
    () => ({
      ...createNoopCapabilities(),
      notifications: createExpoNotificationCapability(),
      voice: createSpeechRecognitionCapability(),
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
