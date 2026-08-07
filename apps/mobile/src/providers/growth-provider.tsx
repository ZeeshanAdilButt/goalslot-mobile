import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  createConsoleAnalytics,
  createStaticFeatureFlags,
  type AnalyticsCapability,
  type FeatureFlagCapability,
  type FeatureFlagKey,
} from "@goalslot/shared";

interface GrowthContextValue {
  analytics: AnalyticsCapability;
  featureFlags: FeatureFlagCapability;
}

const GrowthContext = createContext<GrowthContextValue | null>(null);

export function GrowthProvider({ children }: { children: ReactNode }) {
  // Console analytics + default-off flags today. A real vendor SDK and a
  // remote-config-backed flag resolver drop in behind the same
  // AnalyticsCapability/FeatureFlagCapability interfaces later — nothing
  // above this provider (or any screen) needs to change when that happens.
  const growth = useMemo<GrowthContextValue>(
    () => ({
      analytics: createConsoleAnalytics(),
      featureFlags: createStaticFeatureFlags(),
    }),
    [],
  );

  return <GrowthContext.Provider value={growth}>{children}</GrowthContext.Provider>;
}

function useGrowthContext(): GrowthContextValue {
  const growth = useContext(GrowthContext);
  if (!growth) {
    throw new Error("useAnalytics/useFeatureFlag must be used within a GrowthProvider");
  }
  return growth;
}

export function useAnalytics(): AnalyticsCapability {
  return useGrowthContext().analytics;
}

export function useFeatureFlag(flag: FeatureFlagKey): boolean {
  return useGrowthContext().featureFlags.isEnabled(flag);
}
