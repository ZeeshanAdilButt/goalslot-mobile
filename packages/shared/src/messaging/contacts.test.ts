import { describe, expect, it } from 'vitest'

import type { IncomingShare, OutgoingShare } from '../api/sharing'
import { buildMessagingContacts, contactsByUserId, contactsWithoutConversation } from './contacts'

const outgoing: OutgoingShare[] = [
  { id: 's1', sharedWith: { id: 'u2', email: 'zoe@example.com', name: 'Zoe' }, isAccepted: true },
  // An emailed invite nobody has accepted yet — no account to address.
  { id: 's2', sharedWith: null },
]

const incoming: IncomingShare[] = [
  { id: 's3', ownerId: 'u3', owner: { id: 'u3', email: 'amir@example.com', name: 'Amir' } },
]

describe('buildMessagingContacts', () => {
  it('merges both directions, drops unaccepted invites, and sorts by name', () => {
    expect(buildMessagingContacts(outgoing, incoming)).toEqual([
      { userId: 'u3', name: 'Amir', email: 'amir@example.com', relationship: 'shared-with-me' },
      { userId: 'u2', name: 'Zoe', email: 'zoe@example.com', relationship: 'shared-with-them' },
    ])
  })

  it('collapses a two-way share into one mutual contact', () => {
    const both: IncomingShare[] = [
      { id: 's4', ownerId: 'u2', owner: { id: 'u2', email: 'zoe@example.com', name: 'Zoe' } },
    ]
    const contacts = buildMessagingContacts(outgoing, both)

    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({ userId: 'u2', relationship: 'mutual' })
  })

  it('falls back to the email when a peer has no name set', () => {
    const nameless: OutgoingShare[] = [
      { id: 's5', sharedWith: { id: 'u9', email: 'nn@example.com', name: null }, isAccepted: true },
    ]
    expect(buildMessagingContacts(nameless, [])[0]?.name).toBe('nn@example.com')
  })

  it('treats a whitespace-only name as unset', () => {
    const blank: OutgoingShare[] = [
      { id: 's6', sharedWith: { id: 'u9', email: 'nn@example.com', name: '   ' }, isAccepted: true },
    ]
    expect(buildMessagingContacts(blank, [])[0]?.name).toBe('nn@example.com')
  })

  it('handles both directories being absent', () => {
    expect(buildMessagingContacts()).toEqual([])
  })

  // Regression cover: getMyShares (unlike getSharedWithMe) is not filtered
  // server-side by acceptance, so this direction has to check isAccepted
  // itself. Before this, a share the caller sent but the recipient hadn't
  // accepted yet still showed up as messageable — selecting them 403'd
  // against the server's canMessage check, which does require isAccepted.
  it('drops an outgoing share the recipient has not accepted yet, even though a real account is attached', () => {
    const pending: OutgoingShare[] = [
      { id: 's7', sharedWith: { id: 'u4', email: 'pending@example.com', name: 'Pat' }, isAccepted: false },
    ]
    expect(buildMessagingContacts(pending, [])).toEqual([])
  })
})

describe('contactsByUserId', () => {
  it('indexes contacts for joining a bare participant id to a name', () => {
    const index = contactsByUserId(buildMessagingContacts(outgoing, incoming))
    expect(index['u2']?.name).toBe('Zoe')
    expect(index['missing']).toBeUndefined()
  })
})

describe('contactsWithoutConversation', () => {
  it('hides people the user already has a thread with', () => {
    const contacts = buildMessagingContacts(outgoing, incoming)
    expect(contactsWithoutConversation(contacts, ['u2']).map((c) => c.userId)).toEqual(['u3'])
  })
})
