import NetInfo from "@react-native-community/netinfo";

import {
  confirmPendingMessage,
  createOfflineSync,
  createOperationRegistry,
  createOutbox,
  markPendingMessage,
  toMessagingError,
  type CreateGoalInput,
  type CreateScheduleBlockInput,
  type CreateTaskInput,
  type CreateTimeEntryInput,
  type Goal,
  type MessagingError,
  type MessagingMessage,
  type MessagingThreadMessage,
  type ScheduleBlock,
  type Task,
  type TimeEntry,
} from "@goalslot/shared";

import { apiClient, notify } from "./api-client";
import { asyncStorageAdapter } from "./async-storage-adapter";
import { deriveOnline } from "./derive-online";
import { droppedTimeEntryMessage } from "./dropped-time-entry-message";
import { messagingClient } from "./messaging-client";
import { goalQueries, messagingQueries, scheduleQueries, taskQueries, timeEntryQueries } from "./queries";
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

/**
 * Exported so features that need connectivity (the messaging WebSocket) reuse
 * this one NetInfo subscription instead of opening a second one. A second
 * listener is not just wasteful — the two can disagree for a tick, which is
 * how you get a socket retrying while the rest of the app already knows it's
 * offline.
 *
 * Deliberately NOT wired into TanStack's `onlineManager`. This app's offline
 * story is the outbox below: a mutation is expected to FAIL while offline so
 * `useQuickAdd`'s `hasResponse` check can decide whether to queue it. Handing
 * `onlineManager` a real signal would make TanStack pause those mutations
 * instead, which silently bypasses the outbox — a bigger behaviour change
 * than any one feature should make on the way past.
 */
export function isOnline(): boolean {
  return online;
}

export function subscribeOnline(callback: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((state) => {
    online = deriveOnline(state);
    callback(online);
  });
}

/** Payload of a queued `messaging-send`. Kept here beside its registration. */
export interface MessagingSendPayload {
  conversationId: string;
  body: string;
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

// A stopped timer is the one create in this app whose payload exists nowhere
// else. A goal or task the user typed can be typed again; elapsed time that
// was measured and then failed to POST is simply gone. The Time Tracker used
// to cover that with a Retry/Discard alert, which is fine for a one-off but
// became the wrong default once starting a timer stopped requiring any setup:
// far more sessions, and a "Discard" button standing between the user and
// their own measured time. Queuing it here means an offline stop is banked
// and replayed on reconnect like every other create.
//
// `onDropped` covers the case none of the above prevents: the queued replay
// itself gets definitively rejected (e.g. a FREE-plan user already at their
// daily entry cap by the time connectivity returns — through another device,
// the web app, or another queued entry syncing first). Before the shared
// engine grew this hook, that drop was silent: the outbox entry just
// vanished, same as any other rejected replay, with no equivalent of the
// live path's "Couldn't save time entry" alert. `messaging-send` below reacts
// to its own definite rejections inline inside `execute` because it needs to
// patch a cache entry synchronously with the throw; this one has no cache
// entry to patch, so it uses the engine's generic hook instead.
operationRegistry.registerOperation<CreateTimeEntryInput, TimeEntry>("time-entry-create", {
  execute: async (payload) => (await apiClient.timeEntries.create(payload)).data,
  invalidateKeys: [timeEntryQueries.timeEntryQueries.all],
  onDropped: (payload) => notify(droppedTimeEntryMessage(payload)),
});

// A message the user sent while offline.
//
// Unlike the creates above, this one patches a cache inside `execute` rather
// than leaving everything to `invalidateKeys`, and it has to: the optimistic
// bubble is still sitting in the thread cache marked 'queued', keyed by its
// client id. A plain invalidate would refetch the thread, the server's row
// would arrive alongside the still-present queued bubble, and the user would
// see their message twice. The outbox entry's `idempotencyKey` IS that client
// id (see useSendMessage), which is what lets the replay find and replace the
// right bubble.
//
// Not idempotency-keyed at the service — jiffy-messaging has no dedupe header
// — so a replay of something that did reach the server would post twice. The
// send path only enqueues when the request produced NO response at all (the
// `hasResponse` check, mirroring useQuickAdd), which is precisely the case
// where nothing arrived.
//
// `invalidateKeys` is the conversation LIST, not the whole ['messaging']
// namespace: the thread is already patched above, and the list needs
// refreshing because a replayed send changes its ordering and preview.
operationRegistry.registerOperation<MessagingSendPayload, MessagingMessage>("messaging-send", {
  execute: async (payload, idempotencyKey) => {
    const messagesKey = messagingQueries.messagingQueries.messages(payload.conversationId);
    try {
      const created = await messagingClient.sendMessage(payload.conversationId, payload.body);
      queryClient.setQueryData<MessagingThreadMessage[]>(messagesKey, (existing) =>
        existing ? confirmPendingMessage(existing, idempotencyKey, created) : existing,
      );
      return created;
    } catch (error) {
      const messagingError = toMessagingError(error);
      if (messagingError.status !== undefined) {
        // The service answered and refused (403 no longer a participant, 404
        // conversation gone, 400 bad body). The sync engine is about to drop
        // this entry, so the bubble has to stop claiming it's still queued —
        // otherwise it sits there as "waiting for connection" forever, for a
        // message that will never be sent.
        queryClient.setQueryData<MessagingThreadMessage[]>(messagesKey, (existing) =>
          existing ? markPendingMessage(existing, idempotencyKey, "failed") : existing,
        );
      }
      // Rethrown in the shape the sync engine reads. It duck-types
      // `err.response.status` to tell "the server said no, drop it" from
      // "no response, we're still offline, stop draining" — and a bare
      // MessagingError has neither, so an unmapped rejection here would
      // wedge the entire outbox (every domain's, not just messaging's)
      // behind an entry that can never succeed.
      throw asOutboxError(messagingError);
    }
  },
  invalidateKeys: [messagingQueries.messagingQueries.conversations()],
});

/**
 * Gives a MessagingError the `{ response: { status } }` shape the shared sync
 * engine duck-types on. A genuine network failure has no status and is
 * rethrown untouched, which is exactly the "still offline" signal the drain
 * wants.
 */
function asOutboxError(error: MessagingError): unknown {
  if (error.status === undefined) return error;
  return Object.assign(error, { response: { status: error.status } });
}

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
