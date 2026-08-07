import NetInfo from "@react-native-community/netinfo";

import {
  createOfflineSync,
  createOperationRegistry,
  createOutbox,
  type CreateGoalInput,
  type CreateScheduleBlockInput,
  type CreateTaskInput,
  type Goal,
  type ScheduleBlock,
  type Task,
} from "@goalslot/shared";

import { apiClient, notify } from "./api-client";
import { asyncStorageAdapter } from "./async-storage-adapter";
import { deriveOnline } from "./derive-online";
import { goalQueries, scheduleQueries, taskQueries } from "./queries";
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

export const operationRegistry = createOperationRegistry();

// Quick-add (src/hooks/useQuickAdd.ts) is the first caller of these: it
// enqueues a create here when the live `apiClient.<domain>.create()` call
// fails without a server response (offline/timeout, per `hasResponse` in
// that hook), and the sync engine replays it by `kind` once connectivity
// returns. `invalidateKeys` points at each domain's whole-collection key
// (not a single filtered list variant) so a replayed create refreshes every
// view of that domain, not just the one quick-add happened to patch
// optimistically.
operationRegistry.registerOperation<CreateGoalInput, Goal>("goal-create", {
  execute: async (payload) => (await apiClient.goals.create(payload)).data,
  invalidateKeys: [goalQueries.goalQueries.all],
});

operationRegistry.registerOperation<CreateTaskInput, Task>("task-create", {
  execute: async (payload) => (await apiClient.tasks.create(payload)).data,
  invalidateKeys: [taskQueries.taskQueries.all],
});

operationRegistry.registerOperation<CreateScheduleBlockInput, ScheduleBlock>("schedule-block-create", {
  execute: async (payload) => (await apiClient.schedule.create(payload)).data,
  invalidateKeys: [scheduleQueries.scheduleQueries.root()],
});

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
