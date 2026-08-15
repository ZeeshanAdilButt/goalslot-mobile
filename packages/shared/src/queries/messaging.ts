// Query-key factory + queryOptions for messaging, same
// factory-around-the-api-group shape as ./notes and ./goals.
//
// Two things differ from the other domains, both forced by the service:
//
//   1. The key namespace is 'messaging', not 'conversations'. Everything the
//      feature caches (conversations, threads, the sharing-derived contact
//      list) hangs off it, so signing out or losing the messaging token can
//      invalidate the whole feature with one key rather than three.
//   2. There is no `detail`/`list` symmetry for messages: a thread is paged
//      backwards from "now" with a `before` cursor, and the app holds the
//      merged result under one stable key per conversation
//      (`['messaging','messages',id]`) rather than one key per page. Paging
//      writes through ../messaging/cache's `mergeOlderMessages`, so the key
//      never has to encode a cursor — which is what keeps a live socket push
//      from having to guess which page key to patch.

import { queryOptions } from '@tanstack/react-query'

import type { MessagingServiceClient } from '../api/messaging'
import type { SharingApi } from '../api/sharing'
import type {
  MessagingContact,
  MessagingConversation,
  MessagingMessage,
  MessagingThreadMessage,
} from '../types/messaging'
import { buildMessagingContacts } from '../messaging/contacts'
import { mergeServerMessages } from '../messaging/cache'

export function createMessagingQueries(client: MessagingServiceClient, sharingApi: SharingApi) {
  const messagingQueries = {
    all: ['messaging'] as const,
    conversations: () => [...messagingQueries.all, 'conversations'] as const,
    conversation: (id: string) => [...messagingQueries.all, 'conversation', id] as const,
    messages: (id: string) => [...messagingQueries.all, 'messages', id] as const,
    contacts: () => [...messagingQueries.all, 'contacts'] as const,
  }

  const fetchConversations = (): Promise<MessagingConversation[]> => client.listConversations()

  const fetchConversation = (id: string): Promise<MessagingConversation> => client.getConversation(id)

  const fetchMessages = (id: string): Promise<MessagingMessage[]> => client.listMessages(id)

  const fetchContacts = async (): Promise<MessagingContact[]> => {
    // Both directions of the sharing graph, in parallel — the picker is
    // useless with only half of it, and serialising two independent reads
    // doubles the time to first paint of the sheet.
    const [outgoing, incoming] = await Promise.all([
      sharingApi.getMyShares(),
      sharingApi.getSharedWithMe(),
    ])
    return buildMessagingContacts(outgoing.data, incoming.data)
  }

  return {
    messagingQueries,
    fetchConversations,
    fetchConversation,
    fetchMessages,
    fetchContacts,

    conversations: () =>
      queryOptions({
        queryKey: messagingQueries.conversations(),
        queryFn: fetchConversations,
      }),

    conversation: (id: string) =>
      queryOptions({
        queryKey: messagingQueries.conversation(id),
        queryFn: () => fetchConversation(id),
      }),

    messages: (id: string) =>
      queryOptions({
        queryKey: messagingQueries.messages(id),
        // Typed as thread messages, not plain server messages: this cache
        // entry legitimately holds optimistic sends alongside confirmed rows
        // (see ../messaging/cache.ts). Typing it as `MessagingMessage[]`
        // would make every optimistic write a cast at the call site and
        // quietly lose the `status`/`clientId` fields the UI renders.
        //
        // `mergeServerMessages` runs HERE, inside the fetch itself, rather
        // than as `structuralSharing`. That looks like the natural home for
        // it — it is, after all, exactly "merge fetched data with what's
        // cached" — but TanStack calls a custom `structuralSharing` on EVERY
        // write to this query's cache, not only on fetch results: manual
        // `queryClient.setQueryData` calls (confirmPendingMessage,
        // reconcileIncomingMessage, removePendingMessage, ... — see
        // ../../apps/mobile/src/lib/messaging-live.ts and
        // useSendMessage.ts) go through the exact same `Query#setData` ->
        // `replaceData` path. `mergeServerMessages` unconditionally keeps any
        // still-pending message found in the PREVIOUS cache value, which is
        // correct for a freshly fetched page that legitimately knows nothing
        // about a local optimistic bubble — but wired up as
        // `structuralSharing` it re-ran on every one of those other writes
        // too, resurrecting the pending bubble each of them had just
        // correctly replaced or removed. That's what turned one sent message
        // into three rendered bubbles: a zombie "Sending…" copy plus two
        // separate confirmed copies (one from the REST response, one from
        // the socket push) that never got deduplicated against each other.
        // Param renamed from TanStack's `client` to `queryClient`: this
        // closure already captures the outer `client` (the jiffy-messaging
        // `MessagingServiceClient` this factory takes), and shadowing it
        // with the QueryClient here — even though `fetchMessages` above
        // resolves its own `client` correctly regardless, since closures
        // bind at definition site — reads as if `fetchMessages(id)` might
        // suddenly mean something else.
        queryFn: async ({ client: queryClient, queryKey }): Promise<MessagingThreadMessage[]> => {
          const serverMessages = await fetchMessages(id)
          const previous = queryClient.getQueryData<MessagingThreadMessage[]>(queryKey)
          // Not an optimisation — a correctness requirement. Every refetch
          // (focus, resume, pull-to-refresh) returns only the newest page,
          // so returning it bare would drop both the older history the user
          // paged in and any message queued offline.
          return mergeServerMessages(previous, serverMessages)
        },
      }),

    contacts: () =>
      queryOptions({
        queryKey: messagingQueries.contacts(),
        queryFn: fetchContacts,
      }),
  }
}
