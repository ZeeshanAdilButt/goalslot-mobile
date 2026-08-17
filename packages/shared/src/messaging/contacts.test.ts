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
  it('merges both directions, drops unclaimed email invites, and sorts by name', () => {
    expect(buildMessagingContacts(outgoing, incoming)).toEqual([
      {
        userId: 'u3',
        name: 'Amir',
        email: 'amir@example.com',
        relationship: 'shared-with-me',
        messageable: true,
      },
      {
        userId: 'u2',
        name: 'Zoe',
        email: 'zoe@example.com',
        relationship: 'shared-with-them',
        messageable: true,
      },
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

  // Regression cover, twice over. getMyShares (unlike getSharedWithMe) is
  // not filtered server-side by acceptance, so this direction has to judge
  // isAccepted itself: the server's canMessage requires it, so treating an
  // unaccepted share as messageable lets the user pick someone and then 403.
  //
  // The first fix for that (991310f) dropped the row entirely, which is what
  // this test used to assert. That is what these two assertions now guard
  // against: for a user whose only sharing links are unaccepted, dropping
  // emptied the picker, and an empty picker is indistinguishable from a
  // broken feature. The person must still be RETURNED — the not-tappable
  // part is carried by `messageable`, not by absence.
  it('keeps an outgoing share the recipient has not accepted yet, but marks it unmessageable', () => {
    const pending: OutgoingShare[] = [
      { id: 's7', sharedWith: { id: 'u4', email: 'pending@example.com', name: 'Pat' }, isAccepted: false },
    ]
    expect(buildMessagingContacts(pending, [])).toEqual([
      {
        userId: 'u4',
        name: 'Pat',
        email: 'pending@example.com',
        relationship: 'shared-with-them',
        messageable: false,
        blockedReason: 'invite-pending',
      },
    ])
  })

  // The field is optional on OutgoingShare, so absence has to mean "not
  // accepted" rather than crashing or defaulting to messageable — a
  // permissive default here would put the 403 straight back.
  it('treats a missing isAccepted as not accepted', () => {
    const unknown: OutgoingShare[] = [
      { id: 's8', sharedWith: { id: 'u5', email: 'unknown@example.com', name: 'Uma' } },
    ]
    expect(buildMessagingContacts(unknown, [])[0]).toMatchObject({
      messageable: false,
      blockedReason: 'invite-pending',
    })
  })

  // canMessage matches an accepted share in EITHER direction, so one
  // accepted half is enough. `messageable` is OR-ed on the mutual merge; if
  // it were overwritten by the incoming pass this would come back false-y or
  // keep a stale blockedReason.
  it('is messageable when only the incoming half of a mutual share is accepted', () => {
    const pendingOutgoing: OutgoingShare[] = [
      { id: 's9', sharedWith: { id: 'u6', email: 'sam@example.com', name: 'Sam' }, isAccepted: false },
    ]
    const acceptedIncoming: IncomingShare[] = [
      { id: 's10', ownerId: 'u6', owner: { id: 'u6', email: 'sam@example.com', name: 'Sam' } },
    ]
    const contacts = buildMessagingContacts(pendingOutgoing, acceptedIncoming)

    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toEqual({
      userId: 'u6',
      name: 'Sam',
      email: 'sam@example.com',
      relationship: 'mutual',
      messageable: true,
    })
    expect(contacts[0]).not.toHaveProperty('blockedReason')
  })

  it('sorts messageable people above ones that only explain why they cannot be tapped', () => {
    const mixed: OutgoingShare[] = [
      { id: 's11', sharedWith: { id: 'u7', email: 'ada@example.com', name: 'Ada' }, isAccepted: false },
      { id: 's12', sharedWith: { id: 'u8', email: 'zed@example.com', name: 'Zed' }, isAccepted: true },
    ]
    expect(buildMessagingContacts(mixed, []).map((c) => c.name)).toEqual(['Zed', 'Ada'])
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

  // The picker is the ONLY place an unmessageable person is visible at all —
  // they have no conversation to appear in. Filtering them here would empty
  // the list for exactly the users this whole change is for.
  it('keeps unmessageable people, since the picker is the only place they appear', () => {
    const pendingOnly: OutgoingShare[] = [
      { id: 's13', sharedWith: { id: 'u4', email: 'pending@example.com', name: 'Pat' }, isAccepted: false },
    ]
    const contacts = buildMessagingContacts(pendingOnly, [])
    expect(contactsWithoutConversation(contacts, []).map((c) => c.userId)).toEqual(['u4'])
  })
})
