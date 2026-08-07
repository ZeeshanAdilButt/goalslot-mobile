import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

const FIVE_MINUTES = 5 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES,
      gcTime: SEVEN_DAYS,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// `createAsyncStoragePersister` wants something shaped like AsyncStorage's
// own `{ getItem, setItem, removeItem }` API, which `@react-native-async-storage/async-storage`
// already satisfies directly — no adapter needed here. This is a different
// interface from the shared package's own `OfflineStorage` seam (see
// src/lib/async-storage-adapter.ts), which the offline outbox uses instead;
// don't conflate the two.
export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
});
