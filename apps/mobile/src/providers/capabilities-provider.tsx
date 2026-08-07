import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createNoopCapabilities, type Capabilities } from "@goalslot/shared";

const CapabilitiesContext = createContext<Capabilities | null>(null);

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  // Real alarm/voice/notification implementations land later (Phase 3+ per
  // dw-time-mobile/DECISIONS.md). Until then this is the one seam the rest
  // of the app reaches through instead of touching a platform API directly.
  const capabilities = useMemo(() => createNoopCapabilities(), []);

  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): Capabilities {
  const capabilities = useContext(CapabilitiesContext);
  if (!capabilities) {
    throw new Error("useCapabilities must be used within a CapabilitiesProvider");
  }
  return capabilities;
}
