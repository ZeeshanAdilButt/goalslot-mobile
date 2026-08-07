import Constants from "expo-constants";

import { createApiClient } from "@goalslot/shared";

import { secureTokenStorage } from "./secure-token-storage";

const DEFAULT_API_BASE_URL = "https://api.goalslot.io";

function getApiBaseUrl(): string {
  return Constants.expoConfig?.extra?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
}

type SessionExpiredHandler = () => void;

// The auth provider (src/providers/auth-provider.tsx) needs to know when the
// api client gives up on refreshing the session, so it can flip its store
// back to `unauthenticated`. But the auth provider also imports *this*
// module to call `apiClient.auth.*` — if this module imported the auth
// provider back to invoke its logout action directly, that would be a
// circular import (api-client -> auth-provider -> api-client).
//
// Instead this module only exposes a settable callback slot. It has no
// compile-time knowledge of the auth provider at all. The auth provider
// registers itself into this slot once, at module init, after both modules
// exist and have finished loading.
let sessionExpiredHandler: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  sessionExpiredHandler = handler;
}

// Placeholder for user-facing notices. No toast/snackbar library is
// installed yet (Phase 4 concern) — this just makes session/offline events
// visible during development.
export function notify(message: string): void {
  console.warn(`[GoalSlot] ${message}`);
}

export const apiClient = createApiClient({
  baseUrl: getApiBaseUrl(),
  storage: secureTokenStorage,
  onSessionExpired: () => {
    sessionExpiredHandler?.();
  },
  notify,
});
