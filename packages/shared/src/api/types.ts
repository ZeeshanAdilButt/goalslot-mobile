// New shape for the "injected-ports" pattern: web and mobile each provide
// their own TokenStorage implementation at the app layer (web: localStorage,
// mobile: expo-secure-store) — this package never touches either directly.

export interface TokenStorage {
  getAccessToken(): Promise<string | null>
  getRefreshToken(): Promise<string | null>
  setTokens(access: string, refresh: string): Promise<void>
  clear(): Promise<void>
}

export interface ApiClientConfig {
  /** Origin only, e.g. "https://api.goalslot.io" — the client appends "/api". */
  baseUrl: string
  storage: TokenStorage
  /**
   * Called when the refresh-token flow definitively fails (no refresh token,
   * or the refresh request itself comes back 401/403). The web app used to
   * hard-redirect to `/login` here; this package just reports the event and
   * lets the app layer decide how to navigate.
   */
  onSessionExpired: () => void
  /** Optional user-facing toast/snackbar hook for non-fatal notices. */
  notify?: (message: string) => void
  /**
   * fetch implementation used only by the Coach chat SSE stream (see
   * api/coach.ts) — everything else goes through axios. Defaults to the
   * environment's global `fetch`, which is correct for web (browser fetch
   * streams response bodies fine) but WRONG for React Native: Hermes'
   * built-in `fetch` cannot read `response.body` as a stream. The mobile
   * app must pass `expo/fetch`'s fetch explicitly (cast to this type at
   * that call site — RN's TS lib set doesn't include "DOM", so the two
   * types aren't structurally checked against each other, just trusted).
   */
  fetchImpl?: typeof fetch
}
