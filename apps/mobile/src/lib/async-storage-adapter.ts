// Implements the shared package's `OfflineStorage` seam on top of
// `@react-native-async-storage/async-storage`. Reusable anywhere the app
// needs a JSON-serializing key/value store shaped like `OfflineStorage`
// (currently: the offline outbox in src/lib/offline.ts). This is a distinct
// interface from the raw AsyncStorage-shaped persister used by
// `@tanstack/query-async-storage-persister` in src/lib/query-client.ts — that
// one talks to AsyncStorage directly and doesn't go through this adapter.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { OfflineStorage } from "@goalslot/shared";

export const asyncStorageAdapter: OfflineStorage = {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return undefined;
    return JSON.parse(raw) as T;
  },

  async set<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },

  async del(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
};
