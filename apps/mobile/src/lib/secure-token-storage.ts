// The ONLY place auth tokens are persisted on this app. Do not mirror them
// into AsyncStorage or a zustand-persisted store — the web app's audit found
// it wastefully duplicates tokens across `localStorage` AND a persisted
// zustand blob, and we're not repeating that here.

import * as SecureStore from "expo-secure-store";

import type { TokenStorage } from "@goalslot/shared";

const ACCESS_TOKEN_KEY = "goalslot-access-token";
const REFRESH_TOKEN_KEY = "goalslot-refresh-token";

export const secureTokenStorage: TokenStorage = {
  async getAccessToken() {
    try {
      return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      // A native read failure (e.g. Android Keystore invalidating the key
      // that protected this value after an OS security patch or reboot)
      // must never become an unhandled rejection — that stalls the app on
      // its loading screen forever instead of showing the login screen.
      // Treat an unreadable value the same as "no token stored" and drop
      // the now-dead key so it stops throwing on every subsequent read.
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
      return null;
    }
  },

  async getRefreshToken() {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
      return null;
    }
  },

  async setTokens(access, refresh) {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh),
    ]);
  },

  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  },
};
