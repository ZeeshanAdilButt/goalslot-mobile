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
// The persister's own default is `throttleTime: 1000`, i.e. up to once a
// second it dehydrates the ENTIRE query cache, JSON.stringify's it on the JS
// thread and writes the whole blob to AsyncStorage. For a heavy account that
// snapshot is on the order of a megabyte, and the note editor's 1 s debounced
// autosave patches the cache on exactly that cadence — so typing in a note
// paid a full-cache serialize per second. Five seconds cuts that ~5x.
//
// Safe: the only thing at risk is up to 5 s of a cache *snapshot*, which the
// server re-supplies on the next fetch. Queued offline edits are a separate
// storage seam entirely — the outbox writes under its own key via
// src/lib/async-storage-adapter.ts (see packages/shared/src/offline/outbox.ts),
// and is not touched by this. No user edit can be lost here.
const CACHE_PERSIST_THROTTLE_MS = 5000;

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  throttleTime: CACHE_PERSIST_THROTTLE_MS,
});
