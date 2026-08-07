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
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",

  async login(email, password) {
    const response = await apiClient.auth.login({ email, password });
    const { accessToken, refreshToken, user } = response.data;
    await secureTokenStorage.setTokens(accessToken, refreshToken);
    set({ user, status: "authenticated" });
  },

  async register(data) {
    const response = await apiClient.auth.register(data);
    const { accessToken, refreshToken, user } = response.data;
    await secureTokenStorage.setTokens(accessToken, refreshToken);
    set({ user, status: "authenticated" });
  },

  async logout() {
    await secureTokenStorage.clear();
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
