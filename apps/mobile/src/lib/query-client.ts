import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, keepPreviousData } from "@tanstack/react-query";

const FIVE_MINUTES = 5 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES,
      gcTime: SEVEN_DAYS,
      retry: false,
      // Several screens put a filter in the query key — goals.tsx keys on the
      // Active/Completed tab, reports.tsx on the selected period. Without this
      // every one of those taps changes the key, finds no cached entry, and
      // drops the whole list to a blocking skeleton before the (usually
      // instant) response lands. Holding the previous key's data means the
      // outgoing list stays on screen and is simply replaced, which is what
      // makes filter switching feel immediate instead of flashing.
      //
      // This only ever substitutes data from the SAME useQuery hook's previous
      // key, so it cannot show one screen's data on another.
      placeholderData: keepPreviousData,
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
