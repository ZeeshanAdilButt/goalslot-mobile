// Not a React context/provider component despite the filename convention —
// it's a zustand store, which needs no wrapper component. It is deliberately
// NOT wired through zustand's `persist` middleware: the access/refresh
// tokens already live in expo-secure-store (src/lib/secure-token-storage.ts)
// and that's the only place session state should be persisted. On app start
// the root layout calls `loadUser()`, which asks the API for the current
// profile (`apiClient.auth.getProfile()`) — if a token from a previous
// launch is still valid, that's how we recover `status: 'authenticated'`
// without ever persisting `user` ourselves.

import { create } from "zustand";

import { hasResponse, type User } from "@goalslot/shared";

import { apiClient, setSessionExpiredHandler } from "../lib/api-client";
import {
  createPushRegistrationPort,
  unregisterPushRegistration,
} from "../lib/push-registration";
import { secureTokenStorage } from "../lib/secure-token-storage";
import { resetSessionState } from "../lib/session-reset";

// Mobile keyboards/autofill routinely tack on a leading/trailing space or
// leave stray capitalization on email addresses (autocapitalize, swipe-typed
// suggestions, password-manager autofill). The API compares emails
// byte-for-byte, so an untrimmed value that matches a real account still
// gets rejected as invalid credentials. Normalising here — rather than only
// in the login screen — means every caller (login, register) benefits.
// Passwords are deliberately left untouched: leading/trailing whitespace in
// a password can be intentional and part of the real secret.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  otp: string;
}

interface AuthState {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",

  // For screens that mutate the profile and get the updated row back —
  // Settings' name edit is the first. Mirrors web's `useAuthStore.setUser`.
  //
  // Deliberately not "just call loadUser() again": loadUser clears tokens
  // and signs out on a genuine (server-answered) rejection of /auth/me, so
  // reusing it here would risk logging the user out over an edge case in
  // the refresh/expiry timing of a change that already landed on the
  // server, instead of just updating the row we already have.
  setUser(user) {
    set({ user });
  },

  async login(email, password) {
    const response = await apiClient.auth.login({ email: normalizeEmail(email), password });
    const { accessToken, refreshToken, user } = response.data;
    // Before the new session's tokens exist, so nothing can fetch and cache
    // under the incoming account while the previous account's caches are
    // still being torn down. Also covers the case logout can't: a process
    // kill between sign-out and sign-in never runs the logout path at all.
    await resetSessionState();
    await secureTokenStorage.setTokens(accessToken, refreshToken);
    set({ user, status: "authenticated" });
  },

  async register(data) {
    const response = await apiClient.auth.register({ ...data, email: normalizeEmail(data.email) });
    const { accessToken, refreshToken, user } = response.data;
    await resetSessionState();
    await secureTokenStorage.setTokens(accessToken, refreshToken);
    set({ user, status: "authenticated" });
  },

  async logout() {
    // FIRST, while the access token is still valid: withdraw this device's
    // push subscription. It is an authenticated DELETE, so it has to happen
    // before the tokens go — afterwards it can only 401, and the row would
    // survive on the server, leaving this phone receiving the previous
    // account's message notifications while signed into a different account
    // or none at all. That's the remote-push counterpart of the local
    // scheduled-notification leak session-reset.ts documents in its point 6.
    //
    // Never throws (see push-registration.ts) — sign-out must complete even
    // if the device is offline at the time.
    await unregisterPushRegistration(createPushRegistrationPort());

    // Tokens are only the key to the door — the previous account's goals,
    // tasks and queued offline writes live in caches behind it. Clearing
    // just the tokens is what let the next person to sign in on this device
    // see the last person's data. See src/lib/session-reset.ts.
    await secureTokenStorage.clear();
    await resetSessionState();
    set({ user: null, status: "unauthenticated" });
  },

  async loadUser() {
    const accessToken = await secureTokenStorage.getAccessToken();
    if (!accessToken) {
      set({ user: null, status: "unauthenticated" });
      return;
    }

    try {
      const response = await apiClient.auth.getProfile();
      set({ user: response.data, status: "authenticated" });
    } catch (err) {
      // `hasResponse` (packages/shared/src/offline/http-error.ts) is the
      // same "did the server actually answer?" check every other offline
      // call site in this app uses (timer.tsx, journal.tsx, notes.tsx,
      // src/lib/offline.ts) to tell a network failure apart from a genuine
      // rejection. A request that never reached the server (no wifi, DNS
      // failure, timeout — going offline right on cold start) has no
      // `.response` at all; it is NOT proof the stored token is invalid, so
      // it must never clear tokens or bounce to the login screen. Doing
      // that here was the direct cause of "turn off wifi, get logged out
      // with no way back in": the token really was deleted, not just the
      // UI's belief about it.
      if (!hasResponse(err)) {
        // Stay optimistically authenticated on the locally stored token —
        // there is no cached profile to show yet, but the alternative
        // (unauthenticated) is strictly worse and unrecoverable while
        // offline. A later authenticated request, or the next loadUser()
        // once connectivity returns, fills in `user`.
        set({ status: "authenticated" });
        return;
      }

      // The server actually answered and rejected the token (expired/
      // invalid, and refresh — handled inside the shared api client —
      // failed too). There's no usable session to show; fall back to
      // unauthenticated rather than getting stuck in `loading` forever.
      //
      // Deliberately NOT resetSessionState(), unlike logout() above: the
      // offline outbox may still hold writes queued by this same account
      // and shouldn't be wiped just because this particular request was
      // rejected. The cost is that reminders queued by the previous
      // account survive this particular exit until someone signs in
      // (login/register both reset).
      await secureTokenStorage.clear();
      set({ user: null, status: "unauthenticated" });
    }
  },
}));

// Registered here (rather than the api-client module importing this one
// directly) to avoid a circular import — see the comment on
// `setSessionExpiredHandler` in src/lib/api-client.ts for the full
// reasoning. This runs once, when this module is first loaded.
setSessionExpiredHandler(() => {
  void useAuthStore.getState().logout();
});

export function useAuth(): AuthState {
  return useAuthStore();
}
