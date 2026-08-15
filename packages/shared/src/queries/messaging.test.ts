// Regression coverage for the "one sent message renders as three bubbles"
// bug. The pure reconcilers in ../messaging/cache.ts (cache.test.ts) were
// already correct in isolation and stayed correct the whole time — the bug
// lived one layer up, in how `messages()`'s queryOptions were wired into a
// real QueryClient. A test of the pure functions alone can never see it,
// because it only exists once `queryClient.setQueryData` is the thing
// applying their output. So this file uses a real QueryClient, the same way
// the app does, rather than calling the reconcilers directly.
//
// The mechanism: TanStack calls a `structuralSharing` function (when one is
// configured) on EVERY write to a query's cache, not just on fetch results —
// see `Query#setData` -> `replaceData` in @tanstack/query-core. `messages()`
// used to hand `mergeServerMessages` to `structuralSharing` on the theory
// that it would only ever see fetched pages. In fact it saw every manual
// `setQueryData` call too (confirmPendingMessage, reconcileIncomingMessage,
// ...), and because `mergeServerMessages` unconditionally keeps any
// still-pending message from the write's own "previous" cache value, it
// resurrected the pending bubble each of those calls had just correctly
// replaced or removed — repeatedly, on every subsequent write. The fix moves
// the merge inside `queryFn` itself, so it only ever runs on an actual fetch.

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { MessagingServiceClient } from '../api/messaging'
import type { SharingApi } from '../api/sharing'
import { confirmPendingMessage, reconcileIncomingMessage, upsertMessage } from '../messaging/cache'
import type { MessagingMessage, MessagingThreadMessage, PendingMessagingMessage } from '../types/messaging'
import { createMessagingQueries } from './messaging'

const CONVERSATION_ID = 'c1'
const CURRENT_USER_ID = 'u1'

function fakeServiceClient(messages: MessagingMessage[] = []): MessagingServiceClient {
  return { listMessages: async () => messages } as unknown as MessagingServiceClient
}

const fakeSharingApi = {} as unknown as SharingApi

function pendingMessage(): PendingMessagingMessage {
  return {
    id: 'local-1',
    clientId: 'local-1',
    conversationId: CONVERSATION_ID,
    senderId: CURRENT_USER_ID,
    body: 'Good',
    createdAt: '2026-08-15T22:08:00.000Z',
    status: 'sending',
  }
}

function confirmedMessage(): MessagingMessage {
  // Same id both times a real send is delivered twice (REST response body +
  // message-bus broadcast) — it's the same persisted row either way.
  return {
    id: 'srv-1',
    conversationId: CONVERSATION_ID,
    senderId: CURRENT_USER_ID,
    body: 'Good',
    createdAt: '2026-08-15T22:08:01.000Z',
  }
}

/** Seeds a QueryClient's cache the way the thread screen's useQuery does — a
 * real fetch through the real queryOptions — so later `setQueryData` calls
 * exercise the exact `structuralSharing`/queryFn options production code
 * uses, not just whatever `new QueryClient()` defaults to. */
async function seedClient() {
  const { messagingQueries, messages } = createMessagingQueries(fakeServiceClient([]), fakeSharingApi)
  const client = new QueryClient()
  const key = messagingQueries.messages(CONVERSATION_ID)
  await client.fetchQuery(messages(CONVERSATION_ID))
  return { client, key }
}

describe('messages() query cache, driven through a real QueryClient', () => {
  it('collapses to one bubble when the REST confirm lands before the socket echo', async () => {
    const { client, key } = await seedClient()
    const pending = pendingMessage()
    const confirmed = confirmedMessage()

    client.setQueryData<MessagingThreadMessage[]>(key, (existing) => upsertMessage(existing ?? [], pending))
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) =>
      confirmPendingMessage(existing ?? [], pending.clientId, confirmed),
    )
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) =>
      reconcileIncomingMessage(existing ?? [], confirmed, CURRENT_USER_ID),
    )

    const final = client.getQueryData<MessagingThreadMessage[]>(key) ?? []
    expect(final.map((m) => m.id)).toEqual(['srv-1'])
    expect(final.some((m) => 'clientId' in m)).toBe(false)
  })

  it('collapses to one bubble when the socket echo lands before the REST confirm', async () => {
    const { client, key } = await seedClient()
    const pending = pendingMessage()
    const confirmed = confirmedMessage()

    client.setQueryData<MessagingThreadMessage[]>(key, (existing) => upsertMessage(existing ?? [], pending))
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) =>
      reconcileIncomingMessage(existing ?? [], confirmed, CURRENT_USER_ID),
    )
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) =>
      confirmPendingMessage(existing ?? [], pending.clientId, confirmed),
    )

    const final = client.getQueryData<MessagingThreadMessage[]>(key) ?? []
    expect(final.map((m) => m.id)).toEqual(['srv-1'])
    expect(final.some((m) => 'clientId' in m)).toBe(false)
  })

  it('never resurrects a discarded pending bubble on a later write', async () => {
    const { client, key } = await seedClient()
    const pending = pendingMessage()

    client.setQueryData<MessagingThreadMessage[]>(key, (existing) => upsertMessage(existing ?? [], pending))
    // Someone else's unrelated message arrives over the socket while the
    // send is still in flight/failed.
    const other: MessagingMessage = {
      id: 'srv-2',
      conversationId: CONVERSATION_ID,
      senderId: 'u2',
      body: 'hey',
      createdAt: '2026-08-15T22:08:02.000Z',
    }
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) =>
      existing ? existing.filter((m) => !('clientId' in m && m.clientId === pending.clientId)) : existing,
    )
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) =>
      reconcileIncomingMessage(existing ?? [], other, CURRENT_USER_ID),
    )

    const final = client.getQueryData<MessagingThreadMessage[]>(key) ?? []
    expect(final.map((m) => m.id)).toEqual(['srv-2'])
  })

  it('still preserves a queued/pending message across a genuine refetch', async () => {
    const { messagingQueries, messages } = createMessagingQueries(fakeServiceClient([]), fakeSharingApi)
    const client = new QueryClient()
    const key = messagingQueries.messages(CONVERSATION_ID)
    await client.fetchQuery(messages(CONVERSATION_ID))

    const pending = pendingMessage()
    client.setQueryData<MessagingThreadMessage[]>(key, (existing) => upsertMessage(existing ?? [], pending))

    // A focus/resume refetch runs the SAME real queryFn again (not a stand-in
    // — this is the one place `mergeServerMessages` is supposed to run). The
    // service still only knows about nothing (the send hasn't reached it —
    // offline/queued), so the fetch itself must not drop the still-pending
    // bubble.
    await client.fetchQuery({ ...messages(CONVERSATION_ID), queryKey: key })
    const final = client.getQueryData<MessagingThreadMessage[]>(key) ?? []
    expect(final.map((m) => m.id)).toEqual(['local-1'])
  })
})
