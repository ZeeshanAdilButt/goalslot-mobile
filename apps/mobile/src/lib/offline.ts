import NetInfo from "@react-native-community/netinfo";

import {
  confirmPendingMessage,
  createOfflineSync,
  createOperationRegistry,
  createOutbox,
  genId,
  hasResponse,
  markPendingMessage,
  toMessagingError,
  type CompleteTaskInput,
  type CreateGoalInput,
  type CreateNoteDto,
  type CreateScheduleBlockInput,
  type CreateTaskInput,
  type CreateTimeEntryInput,
  type Goal,
  type JournalEntry,
  type MessagingError,
  type MessagingMessage,
  type MessagingThreadMessage,
  type Note,
  type NoteReorderItem,
  type ScheduleBlock,
  type Task,
  type TimeEntry,
  type UpdateGoalInput,
  type UpdateNoteDto,
  type UpdateScheduleBlockInput,
  type UpdateTaskInput,
  type UpsertJournalEntryInput,
} from "@goalslot/shared";

import { apiClient, notify } from "./api-client";
import { asyncStorageAdapter } from "./async-storage-adapter";
import { deriveOnline } from "./derive-online";
import { droppedTimeEntryMessage } from "./dropped-time-entry-message";
import { messagingClient } from "./messaging-client";
import { usePendingSyncCount } from "./pending-sync-store";
import {
  goalQueries,
  journalQueries,
  messagingQueries,
  noteQueries,
  scheduleQueries,
  taskQueries,
  timeEntryQueries,
} from "./queries";
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

/**
 * Shared by every edit/complete/delete call site that queues to the outbox
 * (goals.tsx, EditGoalSheet.tsx, tasks.tsx, EditTaskSheet.tsx,
 * ScheduleBlockSheet.tsx, journal.tsx, note/[id].tsx): mirrors
 * useQuickAdd.ts's hasResponse-check -> outbox.addToOutbox shape so every
 * mutation queues exactly the same way instead of N near-identical copies.
 *
 * Returns whether the failure actually got queued: `true` means no server
 * response arrived (offline/timeout) and the entry is now in the outbox, so
 * the caller should keep its optimistic patch (tagged `pendingSync: true`)
 * rather than roll it back. `false` means the server actually answered and
 * rejected the request — nothing was queued, and the caller should roll
 * back to the pre-edit snapshot and show its own inline error, same as
 * before this offline pass.
 */
export async function queueOfflineEdit(kind: string, payload: unknown, err: unknown): Promise<boolean> {
  if (hasResponse(err)) return false;
  await outbox.addToOutbox({
    id: genId(),
    kind,
    payload,
    idempotencyKey: genId(),
    createdAt: Date.now(),
    retries: 0,
  });
  // Keeps <ConnectivityPill/>'s live count current immediately, rather than
  // waiting for the next init()/drain() cycle to notice this entry exists.
  void offlineSync.refreshPendingCount();
  return true;
}

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

// --- Edit/complete/delete operations on EXISTING records --------------------
//
// Unlike the creates above (client-generated id, nothing to roll back to on
// failure — see useQuickAdd.ts), these all target a server id that already
// exists. Their call sites (goals.tsx, EditGoalSheet.tsx, tasks.tsx,
// EditTaskSheet.tsx, ScheduleBlockSheet.tsx) keep the optimistic patch
// applied (tagged `pendingSync: true`, per Goal/Task/ScheduleBlock's own
// header note on that field) rather than rolling it back while the entry
// sits queued — the edit/completion/deletion IS going to happen once the
// outbox drains, so showing it as reverted in the meantime would be wrong in
// the other direction from the false-failure bug this queueing fixes.
//
// Payload shape is `{ id, data }` (or bare `{ id }` for delete/complete/
// restore) because `OfflineOperation.execute` only ever receives the queued
// payload + idempotencyKey — there's no second channel to pass the target
// id, so it travels inside the payload like every other field.

export interface GoalUpdatePayload {
  id: string;
  data: UpdateGoalInput;
}

export interface TaskUpdatePayload {
  id: string;
  data: UpdateTaskInput;
}

export interface TaskCompletePayload {
  id: string;
  data: CompleteTaskInput;
}

export interface ScheduleBlockUpdatePayload {
  id: string;
  data: UpdateScheduleBlockInput;
}

/** Shared by every queued operation that only ever needs the target's id (delete, restore, complete-with-no-extra-fields). */
export interface EntityIdPayload {
  id: string;
}

operationRegistry.registerOperation<GoalUpdatePayload, Goal>("goal-update", {
  execute: async (payload) => (await apiClient.goals.update(payload.id, payload.data)).data,
  invalidateKeys: [goalQueries.goalQueries.all],
});

// A goal's status flip to COMPLETED is just `goals.update` with one field —
// kept as its own outbox `kind` (rather than reusing "goal-update") so a
// queued completion reads unambiguously in the outbox and can't be confused
// with an unrelated field edit made offline in the same session.
operationRegistry.registerOperation<EntityIdPayload, Goal>("goal-complete", {
  execute: async (payload) => (await apiClient.goals.update(payload.id, { status: "COMPLETED" })).data,
  invalidateKeys: [goalQueries.goalQueries.all],
});

operationRegistry.registerOperation<EntityIdPayload, void>("goal-delete", {
  execute: async (payload) => {
    await apiClient.goals.delete(payload.id);
  },
  invalidateKeys: [goalQueries.goalQueries.all],
});

operationRegistry.registerOperation<TaskUpdatePayload, Task>("task-update", {
  execute: async (payload) => (await apiClient.tasks.update(payload.id, payload.data)).data,
  invalidateKeys: [taskQueries.taskQueries.all],
});

operationRegistry.registerOperation<TaskCompletePayload, Task>("task-complete", {
  execute: async (payload) => (await apiClient.tasks.complete(payload.id, payload.data)).data,
  invalidateKeys: [taskQueries.taskQueries.all],
});

operationRegistry.registerOperation<EntityIdPayload, void>("task-delete", {
  execute: async (payload) => {
    await apiClient.tasks.delete(payload.id);
  },
  invalidateKeys: [taskQueries.taskQueries.all],
});

// Restore (DONE -> TODO) deletes the completion time entry and recomputes
// the goal's loggedHours server-side (see tasks.tsx's handleMoveToStatus
// header note) — there is no client-side equivalent, so like every other
// operation here this can only be replayed against the live endpoint, never
// simulated locally.
operationRegistry.registerOperation<EntityIdPayload, Task>("task-restore", {
  execute: async (payload) => (await apiClient.tasks.restore(payload.id)).data,
  invalidateKeys: [taskQueries.taskQueries.all],
});

operationRegistry.registerOperation<ScheduleBlockUpdatePayload, ScheduleBlock>("schedule-block-update", {
  execute: async (payload) => (await apiClient.schedule.update(payload.id, payload.data)).data,
  invalidateKeys: [scheduleQueries.scheduleQueries.root()],
});

// No call site uses this operation yet.
operationRegistry.registerOperation<EntityIdPayload, void>("schedule-block-delete", {
  execute: async (payload) => {
    await apiClient.schedule.delete(payload.id);
  },
  invalidateKeys: [scheduleQueries.scheduleQueries.root()],
});

// --- Journal + note edits ---------------------------------------------------
//
// Journal is one entry per day, keyed by date. One operation ("journal-save")
// covers both create and update via upsert.
//
// NOTE for whoever owns app/(app)/voice.tsx: its `appendToJournal` still
// enqueues "journal-update" against `apiClient.journal.update`, which doesn't
// exist as a route. Pointing it at `apiClient.journal.upsert` / "journal-save"
// is the fix.
operationRegistry.registerOperation<UpsertJournalEntryInput, JournalEntry>("journal-save", {
  execute: async (payload) => (await apiClient.journal.upsert(payload)).data,
  invalidateKeys: [journalQueries.journalQueries.all],
});

// Kept registered under its former name so an already-queued outbox entry
// (persisted in AsyncStorage) still resolves instead of silently discarding
// as an unregistered kind.
operationRegistry.registerOperation<UpsertJournalEntryInput, JournalEntry>("journal-create", {
  execute: async (payload) => (await apiClient.journal.upsert(payload)).data,
  invalidateKeys: [journalQueries.journalQueries.all],
});

/** Journal rows are addressed by date, so this is the by-date counterpart to `EntityIdPayload`. */
export interface JournalDeletePayload {
  date: string;
}

// Removing a whole day's entry (the Journal screen's "Recent entries" rows —
// see app/(app)/journal.tsx). Queued like every other delete in this app: the
// row is already gone from the list and there is no "pending" version of gone
// to render, so unlike the save above this tags nothing `pendingSync`.
//
// Idempotent server-side — the service deletes with `deleteMany`, which never
// throws on a missing row — so a replay that races another device deleting
// the same day still succeeds instead of draining into a drop.
operationRegistry.registerOperation<JournalDeletePayload, void>("journal-delete", {
  execute: async (payload) => {
    await apiClient.journal.delete(payload.date);
  },
  invalidateKeys: [journalQueries.journalQueries.all],
});

// Notes: title/content autosave (note/[id].tsx) was the first thing queued
// here — the highest-risk gap of the notes surface, since it's the one place
// typed content can be lost outright if the user leaves the screen before
// reconnecting. Create/delete/reorder/favorite (notes.tsx) now queue too,
// closing what used to be an accepted scope-cut (see the git history on this
// block): those four actions used to only give "honest" offline messaging
// (a clear "you're offline" alert instead of a misleading "please try
// again"), never an actual queue-and-replay.
export interface NoteUpdatePayload {
  id: string;
  data: UpdateNoteDto;
}

operationRegistry.registerOperation<NoteUpdatePayload, Note>("note-update", {
  execute: async (payload) => (await apiClient.notes.update(payload.id, payload.data)).data,
  invalidateKeys: [noteQueries.noteQueries.all],
});

// `CreateNoteDto.id` (packages/shared/src/types/note.ts) is the optional
// client-generated id ported from the web's own note.create offline
// operation, which exists specifically for this: notes.tsx's createNote
// generates the id up front and sends it in the live/queued create alike, so
// the row created here has the SAME id the optimistic cache entry already
// used. That matters because a queued create can be followed by queued
// note-update entries against that same id (the user opened the brand-new
// page and kept typing while still offline) — the outbox drains strictly
// FIFO, so note-create always replays before any note-update queued after
// it, and by the time the update runs the id is real.
operationRegistry.registerOperation<CreateNoteDto, Note>("note-create", {
  execute: async (payload) => (await apiClient.notes.create(payload)).data,
  invalidateKeys: [noteQueries.noteQueries.all],
});

// Reused by both notes.tsx call sites that produce a `PUT /notes/reorder`
// payload: drag-and-drop/the a11y move actions (applyReorder), and the
// reparent-surviving-children step deleteNote runs before a delete when the
// deleted page has subpages. One `kind` covers both because the payload
// shape (and the replay) is identical either way — the outbox has no notion
// of "why" a reorder was queued, only "apply this NoteReorderItem[]".
operationRegistry.registerOperation<NoteReorderItem[], void>("note-reorder", {
  execute: async (payload) => {
    await apiClient.notes.reorder(payload);
  },
  invalidateKeys: [noteQueries.noteQueries.all],
});

operationRegistry.registerOperation<EntityIdPayload, void>("note-delete", {
  execute: async (payload) => {
    await apiClient.notes.delete(payload.id);
  },
  invalidateKeys: [noteQueries.noteQueries.all],
});

// Favorite is mechanically just `notes.update` with one field, but — same
// reasoning as "goal-complete" above — it gets its own `kind` rather than
// reusing "note-update" so a queued favorite toggle reads unambiguously in
// the outbox instead of looking like an unrelated title/content edit queued
// in the same offline session.
export interface NoteFavoritePayload {
  id: string;
  isFavorite: boolean;
}

operationRegistry.registerOperation<NoteFavoritePayload, Note>("note-favorite", {
  execute: async (payload) => (await apiClient.notes.update(payload.id, { isFavorite: payload.isFavorite })).data,
  invalidateKeys: [noteQueries.noteQueries.all],
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
//
// The `idempotencyKey` the sync engine hands `execute` must be forwarded to
// the API and reused across every replay — otherwise a slow create that
// times out client-side but still commits server-side gets duplicated on
// retry, since the server can't recognise the replay as the same request.
operationRegistry.registerOperation<CreateTimeEntryInput, TimeEntry>("time-entry-create", {
  execute: async (payload, idempotencyKey) =>
    (await apiClient.timeEntries.create(payload, { idempotencyKey })).data,
  invalidateKeys: [timeEntryQueries.timeEntryQueries.all],
  onDropped: (payload) => notify(droppedTimeEntryMessage(payload), "error"),
});

// Removing an already-logged session (the Time Tracker's history rows — see
// components/timer/SessionHistory.tsx). Queued like every other delete in
// this app: the row is already gone from the list and there is no "pending"
// version of gone to show, so unlike the edits above this one carries no
// `pendingSync` tag on anything.
//
// Two invalidate keys, which none of the other deletes here need: the API
// recomputes the entry's goal `loggedHours` when it removes the row
// (dw-time-api's time-entries.service.ts), so a replayed delete leaves the
// goal collection just as stale as the entry collection — and Goals, Today
// and Reports all read the former without ever touching the latter.
// Invalidating unconditionally rather than only for an attributed entry:
// the outbox payload is a bare id by the time this replays, with no memory
// of whether that entry had a goal, and an extra refetch is cheaper than
// carrying a denormalised flag through the queue to avoid it.
operationRegistry.registerOperation<EntityIdPayload, void>("time-entry-delete", {
  execute: async (payload) => {
    await apiClient.timeEntries.delete(payload.id);
  },
  invalidateKeys: [timeEntryQueries.timeEntryQueries.all, goalQueries.goalQueries.all],
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
  // Previously dropped the `kind` argument entirely (`notify: (message) =>
  // notify(message)`), which meant every sync summary — success AND
  // failure — rendered with whatever `notify`'s own default happened to be.
  // Passed through now that `notify` (api-client.ts) actually does something
  // with it (a success-tinted vs. error-tinted toast).
  notify: (message, kind) => notify(message, kind),
  // Keeps src/lib/pending-sync-store.ts (and so <ConnectivityPill/>) current
  // with the outbox's real count across every refresh/drain.
  onPendingCountChange: (count) => usePendingSyncCount.getState().setCount(count),
});
