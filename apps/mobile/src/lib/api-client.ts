import Constants from "expo-constants";
// `expo/fetch` (not React Native's built-in global `fetch`) — Hermes'
// fetch cannot expose `response.body` as a readable stream, so reading an
// SSE reply chunk-by-chunk silently doesn't work with it (the body only
// resolves once, fully buffered, same as calling `.text()`). `expo/fetch`
// is backed by native networking (NSURLSession on iOS, OkHttp on Android)
// and returns a real WHATWG `Response` whose `.body.getReader()` streams
// incrementally, same shape the browser gives web. It ships inside the
// `expo` package already installed here — no new dependency. Verified via
// apps/mobile/node_modules/expo/build/winter/fetch/FetchResponse.d.ts,
// which types `body` as `ReadableStream<Uint8Array> | null`.
import { fetch as expoFetch } from "expo/fetch";

import { createApiClient } from "@goalslot/shared";

import { secureTokenStorage } from "./secure-token-storage";
import { showToast, type ToastKind } from "./toast-store";

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

// User-facing notices: session expiry (this module's own `notify?.(...)`
// call above), and — via src/lib/offline.ts's `createOfflineSync` config —
// the shared sync engine's "Synced N offline changes" / "N offline changes
// could not be synced" summaries and the dropped-time-entry message. Backed
// by src/lib/toast-store.ts's queue and rendered by <ToastHost/>
// (src/components/ToastHost.tsx, mounted once in app/_layout.tsx).
//
// `kind` defaults to "success" so this still satisfies the plain
// `(message: string) => void` shape createApiClient's config expects
// (packages/shared/src/api/types.ts) for the session-expired call above,
// while offline.ts's richer callers pass it explicitly.
export function notify(message: string, kind: ToastKind = "success"): void {
  showToast(message, kind);
}

export const apiClient = createApiClient({
  baseUrl: getApiBaseUrl(),
  storage: secureTokenStorage,
  onSessionExpired: () => {
    sessionExpiredHandler?.();
  },
  notify,
  // `expo/fetch`'s type doesn't structurally match the DOM `typeof fetch`
  // shared/api/coach.ts declares (this app's tsconfig extends
  // expo/tsconfig.base, which doesn't include the "DOM" lib shared's
  // package.json opts into for that one file) — cast at this single
  // boundary rather than loosening either side's types.
  fetchImpl: expoFetch as unknown as typeof fetch,
});
