// Optimistic send for the thread screen.
//
// Follows the same shape as `useQuickAdd` (this repo's stand-in for the web
// app's `useOfflineMutation`, which was never ported — see that file's header
// for why): patch the cache, fire the live call, invalidate on success, roll
// back on failure, and enqueue into the offline outbox only when the request
// produced NO response at all. `src/lib/offline.ts` registers the matching
// "messaging-send" operation and the sync engine replays it on reconnect.
//
// Two ways a chat send differs from a quick-add create, and both change the
// rollback:
//
//   1. A failed message must NOT vanish. Deleting the bubble silently loses
//      what the user wrote. It stays on screen marked 'failed' with a retry,
//      or 'queued' when it's waiting for connectivity — `removePending` is
//      only reached if the user explicitly discards it.
//   2. The server's row replaces the optimistic one rather than being
//      appended next to it, matched on `clientId` — see the shared
//      `confirmPendingMessage`. That also has to survive the socket
//      delivering the same message first, which it does.

import { useCallback, useState } from "react";

import {
  applyMessageToConversations,
  confirmPendingMessage,
  genId,
  markPendingMessage,
  MAX_MESSAGE_LENGTH,
  removePendingMessage,
  toMessagingError,
  upsertMessage,
  type MessagingConversation,
  type MessagingThreadMessage,
  type PendingMessagingMessage,
} from "@goalslot/shared";

import { messagingClient } from "@/lib/messaging-client";
import { useMessagingUiStore } from "@/lib/messaging-ui-store";
import { outbox, type MessagingSendPayload } from "@/lib/offline";
import { messagingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { hapticLight } from "@/lib/haptics";

export interface UseSendMessageResult {
  send: (body: string) => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  discard: (clientId: string) => void;
  isSending: boolean;
  /** Message from the most recent failure; cleared at the start of the next send. */
  error: string | null;
  clearError: () => void;
}

export function useSendMessage(conversationId: string, currentUserId: string): UseSendMessageResult {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearDraft = useMessagingUiStore((state) => state.clearDraft);

  const messagesKey = messagingQueries.messagingQueries.messages(conversationId);
  const conversationsKey = messagingQueries.messagingQueries.conversations();

  const patchThread = useCallback(
    (mutate: (existing: MessagingThreadMessage[]) => MessagingThreadMessage[]) => {
      queryClient.setQueryData<MessagingThreadMessage[]>(messagesKey, (existing) => mutate(existing ?? []));
    },
    [messagesKey],
  );

  const deliver = useCallback(
    async (pending: PendingMessagingMessage) => {
      setIsSending(true);
      setError(null);
      try {
        const confirmed = await messagingClient.sendMessage(conversationId, pending.body);

        patchThread((existing) => confirmPendingMessage(existing, pending.clientId, confirmed));
        // Keeps the conversation list's ordering and preview correct without
        // a refetch — the same patch the socket would have applied, done
        // locally because the sender's own socket frame may lag the response.
        queryClient.setQueryData<MessagingConversation[]>(conversationsKey, (existing) =>
          existing ? applyMessageToConversations(existing, confirmed) : existing,
        );
        clearDraft(conversationId);
        hapticLight();
      } catch (err) {
        const messagingError = toMessagingError(err);

        // `kind === 'network'` IS useQuickAdd's `hasResponse` check, already
        // made: the service client maps "axios rejected with no response" to
        // exactly this kind (see toMessagingError). Anything else means the
        // service answered.
        if (messagingError.kind === "network") {
          // Nothing reached the service, so replaying it later can't
          // duplicate. Leave the bubble visible as 'queued'.
          patchThread((existing) => markPendingMessage(existing, pending.clientId, "queued"));
          const payload: MessagingSendPayload = { conversationId, body: pending.body };
          await outbox.addToOutbox({
            id: genId(),
            kind: "messaging-send",
            payload,
            idempotencyKey: pending.clientId,
            createdAt: Date.now(),
            retries: 0,
          });
          clearDraft(conversationId);
          setError(null);
          return;
        }

        // The service answered and said no. Replaying wouldn't help, so this
        // one waits for the user: bubble stays, marked failed, with a retry.
        patchThread((existing) => markPendingMessage(existing, pending.clientId, "failed"));
        setError(messagingError.message);
      } finally {
        setIsSending(false);
      }
    },
    [clearDraft, conversationId, conversationsKey, patchThread],
  );

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) return;

      const clientId = genId();
      const pending: PendingMessagingMessage = {
        // Until the server assigns one, the client id doubles as the React
        // key. `confirmPendingMessage` swaps in the real row wholesale, so
        // this id never leaks into anything that outlives the send.
        id: clientId,
        clientId,
        conversationId,
        senderId: currentUserId,
        body: trimmed,
        createdAt: new Date().toISOString(),
        status: "sending",
      };

      patchThread((existing) => upsertMessage(existing, pending));
      await deliver(pending);
    },
    [conversationId, currentUserId, deliver, patchThread],
  );

  const retry = useCallback(
    async (clientId: string) => {
      const existing = queryClient.getQueryData<MessagingThreadMessage[]>(messagesKey) ?? [];
      const pending = existing.find(
        (message): message is PendingMessagingMessage => "clientId" in message && message.clientId === clientId,
      );
      if (!pending) return;

      patchThread((messages) => markPendingMessage(messages, clientId, "sending"));
      await deliver(pending);
    },
    [deliver, messagesKey, patchThread],
  );

  const discard = useCallback(
    (clientId: string) => {
      patchThread((existing) => removePendingMessage(existing, clientId));
      setError(null);
    },
    [patchThread],
  );

  return {
    send,
    retry,
    discard,
    isSending,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
