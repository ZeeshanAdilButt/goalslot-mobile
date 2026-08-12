// Read-only slice of dw-time-web's `sharingApi` (src/lib/api.ts:311-339).
// Only the two directory reads are ported, and only because messaging needs
// them: jiffy-messaging identifies participants by bare user id, so the app
// needs *some* source of "who is this person and am I allowed to message
// them". The sharing graph is that source.
//
// Deliberately NOT ported: invite/accept/decline/revoke, public links, and
// the shared-data reads (time entries, goals). Sharing *management* is still
// a web-only surface (see DECISIONS.md §5) and nothing here should make it
// look otherwise.

import type { AxiosInstance } from 'axios'

/** The user half of a SharedAccess row, as the API selects it. */
export interface SharingPeer {
  id: string
  email: string
  name: string | null
  avatar?: string | null
}

/** GET /sharing/my-shares — people the signed-in user shared their data with. */
export interface OutgoingShare {
  id: string
  /**
   * Null while an emailed invite is outstanding: the row exists, but no
   * GoalSlot account is attached to it yet. Those can't be messaged, and
   * `buildMessagingContacts` drops them.
   */
  sharedWith: SharingPeer | null
  isAccepted?: boolean
}

/** GET /sharing/shared-with-me — people who shared their data with the signed-in user. */
export interface IncomingShare {
  id: string
  ownerId: string
  owner: SharingPeer
}

export function createSharingApi(api: AxiosInstance) {
  return {
    getMyShares: () => api.get<OutgoingShare[]>('/sharing/my-shares'),
    getSharedWithMe: () => api.get<IncomingShare[]>('/sharing/shared-with-me'),
  }
}

export type SharingApi = ReturnType<typeof createSharingApi>
