import { describe, expect, it } from 'vitest'

import type { MessagingConversation, MessagingMessage } from '../types/messaging'
import { countUnreadConversations, findCounterpart, isConversationUnread, lastReadAtFor } from './unread'

const ME = 'u1'
const THEM = 'u2'

function conversation(lastReadAt: string | null, lastMessage?: MessagingMessage | null): MessagingConversation {
  return {
    id: 'c1',
    participants: [
      { userId: ME, lastReadAt },
      { userId: THEM, lastReadAt: null },
    ],
    ...(lastMessage !== undefined ? { lastMessage } : {}),
  }
}

function incoming(createdAt: string): MessagingMessage {
  return { id: 'm1', conversationId: 'c1', senderId: THEM, body: 'hi', createdAt }
}

describe('isConversationUnread', () => {
  it('is unread when the newest message arrived after the last read', () => {
    expect(isConversationUnread(conversation('2026-08-12T09:00:00.000Z'), ME, incoming('2026-08-12T10:00:00.000Z'))).toBe(true)
  })

  it('is read when the last read is newer than the message', () => {
    expect(isConversationUnread(conversation('2026-08-12T11:00:00.000Z'), ME, incoming('2026-08-12T10:00:00.000Z'))).toBe(false)
  })

  it('never marks your own message unread — sending is not reading', () => {
    const own: MessagingMessage = { id: 'm1', conversationId: 'c1', senderId: ME, body: 'hi', createdAt: '2026-08-12T10:00:00.000Z' }
    expect(isConversationUnread(conversation(null), ME, own)).toBe(false)
  })

  it('treats a never-read conversation with an incoming message as unread', () => {
    expect(isConversationUnread(conversation(null), ME, incoming('2026-08-12T10:00:00.000Z'))).toBe(true)
  })

  it('is not unread when there are no messages at all', () => {
    expect(isConversationUnread(conversation(null), ME, null)).toBe(false)
    expect(isConversationUnread(conversation(null), ME, undefined)).toBe(false)
  })

  it('is not unread when the message timestamp is unparseable, rather than defaulting to a permanent dot', () => {
    expect(isConversationUnread(conversation(null), ME, incoming('not-a-date'))).toBe(false)
  })
})

describe('lastReadAtFor', () => {
  it('is 0 for a participant that never read, and for a garbage timestamp', () => {
    expect(lastReadAtFor(conversation(null), ME)).toBe(0)
    expect(lastReadAtFor(conversation('nonsense'), ME)).toBe(0)
  })

  it('is 0 for a user who is not a participant', () => {
    expect(lastReadAtFor(conversation('2026-08-12T10:00:00.000Z'), 'stranger')).toBe(0)
  })
})

describe('findCounterpart', () => {
  it('returns the other participant', () => {
    expect(findCounterpart(conversation(null), ME)?.userId).toBe(THEM)
  })

  it('is undefined for a conversation with only the signed-in user', () => {
    const selfOnly: MessagingConversation = { id: 'c1', participants: [{ userId: ME, lastReadAt: null }] }
    expect(findCounterpart(selfOnly, ME)).toBeUndefined()
  })
})

describe('countUnreadConversations', () => {
  it('counts only conversations whose own lastMessage is unread', () => {
    const list: MessagingConversation[] = [
      { ...conversation(null, incoming('2026-08-12T10:00:00.000Z')), id: 'a' },
      { ...conversation('2026-08-12T11:00:00.000Z', incoming('2026-08-12T10:00:00.000Z')), id: 'b' },
      { ...conversation(null, null), id: 'c' },
    ]
    expect(countUnreadConversations(list, ME)).toBe(1)
  })
})
