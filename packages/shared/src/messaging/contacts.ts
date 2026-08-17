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

function toContact(peer: SharingPeer, relationship: MessagingContact['relationship']): MessagingContact {
  return {
    userId: peer.id,
    name: displayName(peer),
    email: peer.email,
    ...(peer.avatar ? { avatar: peer.avatar } : {}),
    relationship,
  }
}

export function buildMessagingContacts(
  outgoing: OutgoingShare[] = [],
  incoming: IncomingShare[] = [],
): MessagingContact[] {
  const byUserId = new Map<string, MessagingContact>()

  for (const share of outgoing) {
    // Null while an emailed invite is still outstanding — there is no account
    // to address a message to yet. `getSharedWithMe` (the `incoming` half)
    // is already filtered to accepted shares server-side, but `getMyShares`
    // is not — it returns every share the caller sent regardless of whether
    // the recipient has accepted, so this direction needs its own check.
    // Skipping unaccepted ones matters beyond tidiness: the server's
    // canMessage check requires isAccepted, so offering someone here who
    // hasn't accepted yet would let the user pick them and then 403.
    if (!share.sharedWith || share.isAccepted !== true) continue
    byUserId.set(share.sharedWith.id, toContact(share.sharedWith, 'shared-with-them'))
  }

  for (const share of incoming) {
    const existing = byUserId.get(share.owner.id)
    byUserId.set(
      share.owner.id,
      existing
        ? { ...existing, relationship: 'mutual' }
        : toContact(share.owner, 'shared-with-me'),
    )
  }

  return Array.from(byUserId.values()).sort((a, b) => a.name.localeCompare(b.name))
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
 */
export function contactsWithoutConversation(
  contacts: MessagingContact[],
  existingCounterpartIds: Iterable<string>,
): MessagingContact[] {
  const taken = new Set(existingCounterpartIds)
  return contacts.filter((contact) => !taken.has(contact.userId))
}
