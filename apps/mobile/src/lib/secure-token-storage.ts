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
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  },

  async getRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
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
