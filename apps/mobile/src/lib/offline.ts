import NetInfo from "@react-native-community/netinfo";

import { createOfflineSync, createOperationRegistry, createOutbox } from "@goalslot/shared";

import { asyncStorageAdapter } from "./async-storage-adapter";
import { notify } from "./api-client";
import { deriveOnline } from "./derive-online";
import { queryClient } from "./query-client";

// NetInfo has no synchronous "give me the current state" accessor, so we
// track it ourselves: seed from an initial `fetch()` call, then keep it
// current via the subscription below. `isOnline` (a sync function the shared
// package's sync engine polls) reads this cached value.
let online = true;

NetInfo.fetch()
  .then((state) => {
    online = deriveOnline(state);
  })
  .catch(() => {
    // Leave the optimistic default in place if the initial fetch fails.
  });

function isOnline(): boolean {
  return online;
}

function subscribeOnline(callback: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((state) => {
    online = deriveOnline(state);
    callback(online);
  });
}

export const outbox = createOutbox(asyncStorageAdapter);

// Empty for now — no per-entity operations (goal/task/schedule mutations)
// exist yet. That's Phase 4. Registering it here just proves the seam is
// wired end to end: the sync engine will look up operations by `kind` and
// find nothing until Phase 4 registers them.
export const operationRegistry = createOperationRegistry();

export const offlineSync = createOfflineSync({
  outbox,
  registry: operationRegistry,
  isOnline,
  subscribeOnline,
  invalidateQueries: (queryKey) => {
    void queryClient.invalidateQueries({ queryKey });
  },
  notify: (message) => notify(message),
});
