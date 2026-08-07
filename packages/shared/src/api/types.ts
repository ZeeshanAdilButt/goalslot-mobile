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
}
