// Shared "how should a failed query render?" decision, factored out of
// QueryErrorState.tsx so it's testable without a component-rendering setup
// (this codebase's convention throughout: derive-online.ts + ConnectivityPill,
// aggregate.ts + the reports components — logic in src/lib, presentation in
// src/components).
//
// The bug this exists to fix, reported independently on three screens
// (Journal, Notes, Reports/Categories) before this sweep: a query's
// `isError` branch rendered the same hard "something went wrong" panel for
// two very different failures — the server genuinely rejecting the request,
// and the device having no network path to the server at all (offline, DNS
// failure, timeout). Those need different copy (and arguably a different
// icon), because only one of them means anything is actually wrong with the
// user's data.
//
// `hasResponse` (packages/shared/src/offline/http-error.ts) is the one
// canonical check this whole codebase already uses to tell them apart —
// mutations queue to the offline outbox on exactly this signal (see
// src/lib/offline.ts's `queueOfflineEdit`, src/hooks/useQuickAdd.ts). This
// reuses that same function rather than re-deriving the axios-error shape,
// so a query-error branch and a mutation's offline-queue check can never
// quietly disagree about what "offline" means.
import { hasResponse } from "@goalslot/shared";

import type { IconName } from "@/components/ui/Icon";

export interface QueryErrorContent {
  /** Omitted for a genuine server error — ErrorState's own "Something went wrong" default already fits. */
  title?: string;
  message: string;
  iconName?: IconName;
}

const DEFAULT_OFFLINE_MESSAGE = "Check your connection and try again.";

/**
 * Classifies a query's `error` for rendering. Call this ONLY once the caller
 * has already decided an error panel is warranted at all — i.e. after its
 * own `isError && !data` (or equivalent) guard, matching the discipline
 * already established in schedule.tsx/goals.tsx/tasks.tsx: a failed
 * background refetch must never blow away perfectly good cached data just
 * because a request happened to fail while offline.
 */
export function describeQueryError(error: unknown, message: string, offlineMessage?: string): QueryErrorContent {
  if (hasResponse(error)) {
    return { message };
  }
  return {
    title: "You're offline",
    message: offlineMessage ?? DEFAULT_OFFLINE_MESSAGE,
    iconName: "wifi-off",
  };
}
