// The local half of "Previous chats" (see packages/shared/src/coach/
// conversation-index.ts for the framework-agnostic types and pure helpers
// this wraps). Backend constraint that shapes everything here: the Coach API
// keys one conversation per (user, scopeKey) — no thread ids, no
// "list my conversations" endpoint. The server stays authoritative for the
// CONTENT of a live conversation (see coachQueries.chat(scopeKey), used by
// both Coach and now Voice); this module only adds the two things the
// server can't provide:
//   1. enumerability — a local index of every scopeKey the user has talked
//      to the Coach through, so there's something to list at all.
//   2. non-destructive "New chat" — since clearing a scopeKey server-side is
//      real and permanent (there's no thread id to spin up a fresh one
//      under), a snapshot taken locally right before the clear is the only
//      way "New chat" isn't simply "delete this conversation".
//
// Unlike this file's *-store.ts siblings (settings-store.ts, timer-store.ts,
// messaging-ui-store.ts), this is NOT a zustand `persist` store. Those all
// serialize one state object under a single storage key, which doesn't fit
// here: an archived conversation's full turn content has to live OUTSIDE the
// index (`coach:archive:{id}`, one key per archive) so the index itself
// (`coach:conversationIndex:v1`) stays small and fast to read on every list
// render even once a user has dozens of archived threads. Screens that want
// the list to re-render on change (CoachHistorySheet) just re-call
// `listConversations()` on their own present()/refresh, the same way any
// other screen re-runs a `useQuery` — there's no long-lived subscribed state
// to keep in sync here.
//
// Every export is a plain async function operating directly on AsyncStorage;
// none of it throws on a storage failure (a corrupt or missing key reads
// back as "no data" rather than crashing a screen that just wanted to show a
// history list).

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  deriveConversationPreview,
  deriveConversationTitle,
  genId,
  insertArchivedConversationEntry,
  removeConversationIndexEntry,
  resetLiveConversationEntry,
  sortConversationsByRecency,
  summariseTurnsForArchive,
  upsertLiveConversationEntry,
  type ConversationIndexEntry,
  type ConversationTurnSnapshot,
} from "@goalslot/shared";

import { apiClient } from "./api-client";

const INDEX_KEY = "coach:conversationIndex:v1";
const archiveKey = (id: string) => `coach:archive:${id}`;

/** Full turn content for one `kind: "archived"` entry — stored separately from the index, see the header comment. */
export interface ArchivedConversationPayload {
  id: string;
  scopeKey: string;
  turns: ConversationTurnSnapshot[];
  archivedAt: string;
}

async function readIndex(): Promise<ConversationIndexEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConversationIndexEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: ConversationIndexEntry[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

/**
 * Upserts the "live" index entry for `scopeKey`. Call this after every
 * successful send from both Voice and Coach — it's the only thing that
 * makes a conversation show up in "Previous chats" at all, since there is
 * no server endpoint to discover it from later.
 */
export async function recordConversationActivity(scopeKey: string, latestMessageContent: string): Promise<void> {
  const entries = await readIndex();
  const next = upsertLiveConversationEntry(entries, {
    scopeKey,
    latestMessageContent,
    now: new Date().toISOString(),
  });
  await writeIndex(next);
}

/** Every known conversation, most recently active first. */
export async function listConversations(): Promise<ConversationIndexEntry[]> {
  return sortConversationsByRecency(await readIndex());
}

/**
 * Snapshots `turns` (whatever is on screen right now — Voice's `history` or
 * Coach's `persistedMessages`, converted to the shared `{role, content}`
 * shape by the caller) as a new `kind: "archived"` entry, and returns its
 * generated id. Call this immediately before the destructive
 * `DELETE /coach/chat/:scopeKey` that "New chat" issues — after that call
 * this is the only copy of the conversation left anywhere.
 */
export async function archiveConversation(
  scopeKey: string,
  turns: ConversationTurnSnapshot[],
): Promise<string> {
  const id = genId();
  const now = new Date().toISOString();
  const { title, preview } = summariseTurnsForArchive(turns);

  const payload: ArchivedConversationPayload = { id, scopeKey, turns: [...turns], archivedAt: now };
  await AsyncStorage.setItem(archiveKey(id), JSON.stringify(payload));

  const entry: ConversationIndexEntry = {
    id,
    kind: "archived",
    scopeKey,
    title,
    preview,
    createdAt: now,
    updatedAt: now,
    messageCount: turns.length,
  };
  await writeIndex(insertArchivedConversationEntry(await readIndex(), entry));
  return id;
}

/** The full turn content for an archived entry, or `null` if it was removed (or never existed). */
export async function getArchivedConversation(id: string): Promise<ArchivedConversationPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(archiveKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as ArchivedConversationPayload;
  } catch {
    return null;
  }
}

/**
 * Local-only "hide from list" — never touches the server. For a `live`
 * entry this just drops it from the index (the scopeKey is still a real
 * server conversation; it can be recovered by `backfillFromServer`). For an
 * `archived` entry this also deletes its payload key, since nothing else
 * can ever reach it once it's off the index.
 */
export async function removeIndexEntry(id: string): Promise<void> {
  const entries = await readIndex();
  await writeIndex(removeConversationIndexEntry(entries, id));
  try {
    await AsyncStorage.removeItem(archiveKey(id));
  } catch {
    // The index write above already succeeded — an orphaned archive payload
    // left behind by a failed removeItem is inert dead weight, not a
    // correctness problem, so it's not worth failing this call over.
  }
}

/** "New chat" step 5: the live entry for `scopeKey` goes back to looking fresh once its server conversation has actually been cleared. */
export async function markLiveConversationReset(scopeKey: string): Promise<void> {
  const entries = await readIndex();
  await writeIndex(resetLiveConversationEntry(entries, scopeKey, new Date().toISOString()));
}

/**
 * Best-effort recovery for conversations that predate this feature, or
 * happened on another device: fetches `GET /coach/chat/:scopeKey` for each
 * scopeKey in `scopeKeys` that the index doesn't already know as `live`, and
 * adds an entry for any that come back non-empty. Meant to be called once,
 * non-blockingly, on first History-screen open with a short list of
 * recent-past ISO-week keys — a failed or slow fetch for one week never
 * stops the others, and this never throws.
 */
export async function backfillFromServer(scopeKeys: readonly string[]): Promise<void> {
  const entries = await readIndex();
  const knownLive = new Set(entries.filter((entry) => entry.kind === "live").map((entry) => entry.scopeKey));
  const missing = scopeKeys.filter((scopeKey) => !knownLive.has(scopeKey));
  if (missing.length === 0) return;

  const recovered: ConversationIndexEntry[] = [];
  for (const scopeKey of missing) {
    try {
      const res = await apiClient.coach.getChatHistory(scopeKey);
      const messages = res.data.filter((m) => m.role === "USER" || m.role === "ASSISTANT");
      if (messages.length === 0) continue;
      const first = messages[0];
      const last = messages[messages.length - 1];
      const now = new Date().toISOString();
      recovered.push({
        id: scopeKey,
        kind: "live",
        scopeKey,
        title: deriveConversationTitle(first.content),
        preview: deriveConversationPreview(last.content),
        createdAt: first.createdAt || now,
        updatedAt: last.createdAt || now,
        messageCount: messages.length,
      });
    } catch {
      // Offline, or no conversation ever existed for that week (404) — either
      // way, best-effort means skip it and keep going.
    }
  }
  if (recovered.length > 0) {
    await writeIndex([...entries, ...recovered]);
  }
}
