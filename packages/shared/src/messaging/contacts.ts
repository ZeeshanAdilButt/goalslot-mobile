// Turns the two sharing directories into one addressable people list.
//
// This is a *hint*, not an authorization decision. The server decides who may
// open a conversation with whom (POST /messaging/conversations, 403
// otherwise); this only decides whose name appears in the picker. Keeping
// that distinction explicit matters — a stale cache here must never be able
// to grant access, only to briefly show a name that then fails with a clear
// error.
//
// The two directions genuinely overlap: a mentor and mentee who have both
// shared with each other appear in `my-shares` AND `shared-with-me`, and
// showing them twice is the obvious bug. They dedupe by user id and get the
// 'mutual' relationship label.

import type { IncomingShare, OutgoingShare, SharingPeer } from '../api/sharing'
import type { MessagingContact } from '../types/messaging'

function displayName(peer: SharingPeer): string {
  const trimmed = peer.name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : peer.email
}

function toContact(
  peer: SharingPeer,
  relationship: MessagingContact['relationship'],
  messageable: boolean,
): MessagingContact {
  return {
    userId: peer.id,
    name: displayName(peer),
    email: peer.email,
    ...(peer.avatar ? { avatar: peer.avatar } : {}),
    relationship,
    messageable,
    ...(messageable ? {} : { blockedReason: 'invite-pending' as const }),
  }
}

export function buildMessagingContacts(
  outgoing: OutgoingShare[] = [],
  incoming: IncomingShare[] = [],
): MessagingContact[] {
  const byUserId = new Map<string, MessagingContact>()

  for (const share of outgoing) {
    // A null `sharedWith` is the one case that really is dropped: the invite
    // was emailed and nobody has claimed it, so there is no account to
    // address a message to. There is nothing to render and no id to render
    // it under.
    if (!share.sharedWith) continue

    // Acceptance, by contrast, is reported rather than filtered. This
    // direction needs its own check — `getSharedWithMe` (the `incoming`
    // half) is filtered to accepted shares server-side, but `getMyShares`
    // returns every share the caller sent regardless — because the server's
    // canMessage requires isAccepted, so opening a conversation with someone
    // who hasn't accepted 403s.
    //
    // An earlier fix (991310f) drew the obvious conclusion and `continue`d
    // past them. That removed the 403, but for a user whose only sharing
    // links are unaccepted it emptied the picker completely, which read as
    // the feature being broken. Keeping the person visible with
    // `messageable: false` prevents the 403 the same way — the row isn't
    // tappable — while still answering the question the user actually has,
    // which is "where is everyone?".
    byUserId.set(
      share.sharedWith.id,
      toContact(share.sharedWith, 'shared-with-them', share.isAccepted === true),
    )
  }

  for (const share of incoming) {
    const existing = byUserId.get(share.owner.id)
    if (!existing) {
      byUserId.set(share.owner.id, toContact(share.owner, 'shared-with-me', true))
      continue
    }

    // Mutual. `messageable` is OR-ed, never overwritten: canMessage matches
    // an accepted share in EITHER direction, so an accepted incoming share
    // makes this person reachable even if the outgoing half is still
    // pending. Overwriting would have re-hidden the reason on one side and
    // wrongly blocked on the other.
    const merged: MessagingContact = { ...existing, relationship: 'mutual', messageable: true }
    delete merged.blockedReason
    byUserId.set(share.owner.id, merged)
  }

  // Messageable people first, then by name. Someone the user can actually
  // start a conversation with should never be pushed below a row that only
  // explains why it can't be tapped.
  return Array.from(byUserId.values()).sort((a, b) => {
    if (a.messageable !== b.messageable) return a.messageable ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Index for joining a bare participant id to a name at render time. */
export function contactsByUserId(contacts: MessagingContact[]): Record<string, MessagingContact> {
  const index: Record<string, MessagingContact> = {}
  for (const contact of contacts) {
    index[contact.userId] = contact
  }
  return index
}

/**
 * Everyone in the directory who doesn't already have a conversation — what
 * the "new conversation" picker should offer. Someone you're already talking
 * to belongs in the list you came from, not in the new-thread picker.
 *
 * Note that this deliberately does NOT drop `messageable: false` people.
 * They have no conversation and can't yet have one, so the picker is the
 * only surface where they exist at all; showing them greyed with a reason is
 * the entire point of that flag. Filtering here would reintroduce the empty
 * list this flag was added to prevent.
 */
export function contactsWithoutConversation(
  contacts: MessagingContact[],
  existingCounterpartIds: Iterable<string>,
): MessagingContact[] {
  const taken = new Set(existingCounterpartIds)
  return contacts.filter((contact) => !taken.has(contact.userId))
}
