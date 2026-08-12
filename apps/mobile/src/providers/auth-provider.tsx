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

import type { User } from "@goalslot/shared";

import { apiClient, setSessionExpiredHandler } from "../lib/api-client";
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
  // Deliberately not "just call loadUser() again": loadUser treats any failed
  // /auth/me as a dead session and clears the tokens, so a network blip in
  // the seconds after a successful save would sign the user out over a
  // change that already landed on the server.
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
    } catch {
      // Token present but rejected (expired/invalid and refresh failed, or a
      // network error on the very first request). Either way there's no
      // usable session to show — fall back to unauthenticated rather than
      // getting stuck in `loading` forever.
      //
      // Deliberately NOT resetSessionState(), unlike logout() above: the two
      // causes are indistinguishable from here, and on the network-blip one
      // the user is still legitimately signed in — wiping the offline outbox
      // would silently destroy writes they queued while offline. The cost is
      // that reminders queued by the previous account survive this
      // particular exit until someone signs in (login/register both reset).
      // Distinguishing a rejected token from an unreachable server is the
      // fix; until then the destructive option is the worse trade.
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
