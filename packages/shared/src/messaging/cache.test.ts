import { describe, expect, it } from 'vitest'

import type { MessagingConversation, MessagingMessage, PendingMessagingMessage } from '../types/messaging'
import {
  applyMessageToConversations,
  applyReadReceipt,
  confirmPendingMessage,
  markPendingMessage,
  mergeOlderMessages,
  mergeServerMessages,
  newestServerMessage,
  oldestMessageTimestamp,
  reconcileIncomingMessage,
  removePendingMessage,
  sortMessages,
  upsertMessage,
} from './cache'

function message(id: string, createdAt: string, overrides: Partial<MessagingMessage> = {}): MessagingMessage {
  return { id, conversationId: 'c1', senderId: 'u2', body: id, createdAt, ...overrides }
}

function pending(clientId: string, createdAt: string): PendingMessagingMessage {
  return {
    id: clientId,
    clientId,
    conversationId: 'c1',
    senderId: 'u1',
    body: 'hello',
    createdAt,
    status: 'sending',
  }
}

describe('sortMessages', () => {
  it('orders oldest-first and breaks timestamp ties by id so order is stable', () => {
    const a = message('a', '2026-08-12T10:00:00.000Z')
    const b = message('b', '2026-08-12T10:00:00.000Z')
    const c = message('c', '2026-08-12T09:00:00.000Z')

    expect(sortMessages([b, a, c]).map((m) => m.id)).toEqual(['c', 'a', 'b'])
    expect(sortMessages([a, b, c]).map((m) => m.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('upsertMessage', () => {
  it('is idempotent for the same server id, so a socket push after the POST response is a no-op', () => {
    const existing = [message('m1', '2026-08-12T10:00:00.000Z')]
    const next = upsertMessage(existing, message('m1', '2026-08-12T10:00:00.000Z'))
    expect(next).toHaveLength(1)
  })

  it('inserts a new message in timestamp order rather than appending', () => {
    const existing = [message('m2', '2026-08-12T10:00:00.000Z')]
    const next = upsertMessage(existing, message('m1', '2026-08-12T09:00:00.000Z'))
    expect(next.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('confirmPendingMessage', () => {
  it('replaces the optimistic bubble with the server row instead of leaving both', () => {
    const existing = [message('m1', '2026-08-12T09:00:00.000Z'), pending('local-1', '2026-08-12T10:00:00.000Z')]

    const next = confirmPendingMessage(existing, 'local-1', message('srv-1', '2026-08-12T10:00:01.000Z'))

    expect(next.map((m) => m.id)).toEqual(['m1', 'srv-1'])
    expect(next.some((m) => 'clientId' in m)).toBe(false)
  })

  it('does not duplicate when the socket already delivered the same message', () => {
    const alreadyDelivered = message('srv-1', '2026-08-12T10:00:01.000Z')
    const existing = [alreadyDelivered, pending('local-1', '2026-08-12T10:00:00.000Z')]

    const next = confirmPendingMessage(existing, 'local-1', alreadyDelivered)

    expect(next.map((m) => m.id)).toEqual(['srv-1'])
  })
})

describe('reconcileIncomingMessage', () => {
  it('replaces the sender\'s own optimistic bubble instead of rendering a second copy of it', () => {
    const existing = [pending('local-1', '2026-08-12T10:00:00.000Z')]

    // Same body, sent by u1 (who pending() attributes to u1), delivered back
    // over the socket with a real server id and no clientId at all.
    const pushed = message('srv-1', '2026-08-12T10:00:01.000Z', { senderId: 'u1', body: 'hello' })
    const next = reconcileIncomingMessage(existing, pushed, 'u1')

    expect(next.map((m) => m.id)).toEqual(['srv-1'])
    expect(next.some((m) => 'clientId' in m)).toBe(false)
  })

  it('keeps someone else\'s message alongside an unrelated pending bubble of the same text', () => {
    const existing = [pending('local-1', '2026-08-12T10:00:00.000Z')]

    // Identical body, but from the other participant — must NOT swallow the
    // user's own still-sending bubble.
    const pushed = message('srv-1', '2026-08-12T10:00:01.000Z', { senderId: 'u2', body: 'hello' })
    const next = reconcileIncomingMessage(existing, pushed, 'u1')

    expect(next).toHaveLength(2)
    expect(next.map((m) => m.id)).toEqual(['local-1', 'srv-1'])
  })

  it('falls back to a plain upsert when the user has no pending bubble matching it', () => {
    const existing = [message('m1', '2026-08-12T09:00:00.000Z')]
    const pushed = message('srv-1', '2026-08-12T10:00:00.000Z', { senderId: 'u1', body: 'something else' })

    expect(reconcileIncomingMessage(existing, pushed, 'u1').map((m) => m.id)).toEqual(['m1', 'srv-1'])
  })

  it('is idempotent when the socket redelivers a message already confirmed', () => {
    const confirmed = message('srv-1', '2026-08-12T10:00:00.000Z', { senderId: 'u1', body: 'hello' })
    const next = reconcileIncomingMessage([confirmed], confirmed, 'u1')
    expect(next).toHaveLength(1)
  })
})

describe('removePendingMessage / markPendingMessage', () => {
  it('rolls back only the named optimistic bubble', () => {
    const existing = [pending('local-1', '2026-08-12T10:00:00.000Z'), pending('local-2', '2026-08-12T10:00:01.000Z')]
    expect(removePendingMessage(existing, 'local-1').map((m) => m.id)).toEqual(['local-2'])
  })

  it('marks a failed send in place so the bubble stays visible with a retry affordance', () => {
    const existing = [pending('local-1', '2026-08-12T10:00:00.000Z')]
    const next = markPendingMessage(existing, 'local-1', 'failed')
    expect(next).toHaveLength(1)
    expect((next[0] as PendingMessagingMessage).status).toBe('failed')
  })
})

describe('mergeOlderMessages', () => {
  it('drops overlap with what is already held and keeps oldest-first order', () => {
    const existing = [message('m3', '2026-08-12T12:00:00.000Z')]
    const older = [message('m1', '2026-08-12T10:00:00.000Z'), message('m3', '2026-08-12T12:00:00.000Z')]

    expect(mergeOlderMessages(existing, older).map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('returns the same array reference when the page adds nothing, so React does not re-render', () => {
    const existing = [message('m1', '2026-08-12T10:00:00.000Z')]
    expect(mergeOlderMessages(existing, [message('m1', '2026-08-12T10:00:00.000Z')])).toBe(existing)
  })
})

describe('oldestMessageTimestamp', () => {
  it('ignores optimistic messages when producing the next `before` cursor', () => {
    const existing = [pending('local-1', '2026-08-12T08:00:00.000Z'), message('m1', '2026-08-12T10:00:00.000Z')]
    expect(oldestMessageTimestamp(existing)).toBe('2026-08-12T10:00:00.000Z')
  })

  it('is undefined for an empty thread', () => {
    expect(oldestMessageTimestamp([])).toBeUndefined()
  })
})

describe('mergeServerMessages', () => {
  it('keeps a queued offline message across a refetch instead of dropping it', () => {
    const previous = [message('m1', '2026-08-12T10:00:00.000Z'), pending('local-1', '2026-08-12T11:00:00.000Z')]

    const merged = mergeServerMessages(previous, [message('m1', '2026-08-12T10:00:00.000Z')])

    expect(merged.map((m) => m.id)).toEqual(['m1', 'local-1'])
  })

  it('keeps older history the newest page no longer covers', () => {
    const previous = [message('old', '2026-08-01T10:00:00.000Z'), message('m1', '2026-08-12T10:00:00.000Z')]

    const merged = mergeServerMessages(previous, [message('m1', '2026-08-12T10:00:00.000Z'), message('m2', '2026-08-12T12:00:00.000Z')])

    expect(merged.map((m) => m.id)).toEqual(['old', 'm1', 'm2'])
  })

  it('prefers the incoming copy of a message the cache already had', () => {
    const previous = [message('m1', '2026-08-12T10:00:00.000Z', { body: 'stale' })]

    const merged = mergeServerMessages(previous, [message('m1', '2026-08-12T10:00:00.000Z', { body: 'fresh' })])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.body).toBe('fresh')
  })

  it('is just the page when nothing was cached', () => {
    const page = [message('m2', '2026-08-12T12:00:00.000Z'), message('m1', '2026-08-12T10:00:00.000Z')]
    expect(mergeServerMessages(undefined, page).map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(mergeServerMessages([], page).map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('newestServerMessage', () => {
  it('skips optimistic messages so a list preview never shows an unsent message', () => {
    const existing = [message('m1', '2026-08-12T10:00:00.000Z'), pending('local-1', '2026-08-12T11:00:00.000Z')]
    expect(newestServerMessage(existing)?.id).toBe('m1')
  })

  it('is undefined for an empty, all-pending, or absent thread', () => {
    expect(newestServerMessage([])).toBeUndefined()
    expect(newestServerMessage([pending('local-1', '2026-08-12T11:00:00.000Z')])).toBeUndefined()
    expect(newestServerMessage(undefined)).toBeUndefined()
  })
})

describe('applyMessageToConversations', () => {
  const conversations: MessagingConversation[] = [
    { id: 'c1', participants: [{ userId: 'u1', lastReadAt: null }] },
    { id: 'c2', participants: [{ userId: 'u1', lastReadAt: null }] },
  ]

  it('moves the touched conversation to the top and updates its preview', () => {
    const next = applyMessageToConversations(conversations, message('m1', '2026-08-12T10:00:00.000Z', { conversationId: 'c2' }))

    expect(next.map((c) => c.id)).toEqual(['c2', 'c1'])
    expect(next[0]?.lastMessage?.id).toBe('m1')
  })

  it('leaves the list untouched for an unknown conversation rather than inventing one', () => {
    const next = applyMessageToConversations(conversations, message('m1', '2026-08-12T10:00:00.000Z', { conversationId: 'unknown' }))
    expect(next).toBe(conversations)
  })
})

describe('applyReadReceipt', () => {
  it("only stamps the signed-in user's participant row", () => {
    const conversations: MessagingConversation[] = [
      {
        id: 'c1',
        participants: [
          { userId: 'u1', lastReadAt: null },
          { userId: 'u2', lastReadAt: null },
        ],
      },
    ]

    const next = applyReadReceipt(conversations, 'c1', 'u1', '2026-08-12T10:00:00.000Z')

    expect(next[0]?.participants).toEqual([
      { userId: 'u1', lastReadAt: '2026-08-12T10:00:00.000Z' },
      { userId: 'u2', lastReadAt: null },
    ])
  })
})
