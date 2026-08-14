// Read-only slice of dw-time-web's `sharingApi` (src/lib/api.ts:311-339).
//
// Sharing *management* — invite/accept/decline/revoke, public links — stays
// a web-only surface (see DECISIONS.md §5) and is deliberately NOT ported
// here: creating or dissolving a share is a rare, form-heavy flow web
// already covers, and duplicating it buys nothing.
//
// What IS ported, beyond the two directory reads messaging already needed
// (jiffy-messaging identifies participants by bare user id, so the app needs
// *some* source of "who is this person and am I allowed to message them"):
// the mentor-facing reads of a mentee's shared data (time entries, goals).
// That's a different feature — viewing what someone already shared with you
// — not managing the share itself, and it's what apps/mobile's Mentees
// screen is built on.

import type { AxiosInstance } from 'axios'

import type { Goal } from '../types/goal'
import type { TimeEntry } from '../types/time-entry'

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
    /**
     * A mentee's time entries, for the accepted share `ownerId` granted the
     * caller. Same shape the caller's own `/time-entries/range` returns
     * (goal/task are the same reduced projections), so the Reports screen's
     * existing aggregation helpers work unmodified against this response —
     * see apps/mobile's mentee/[id] screen. 403s server-side if the share
     * was revoked or never accepted; nothing here re-checks that client-side.
     */
    getSharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) =>
      api.get<TimeEntry[]>(`/sharing/user/${ownerId}/time-entries`, { params: { startDate, endDate } }),
    /** A mentee's goals, for the accepted share `ownerId` granted the caller. */
    getSharedUserGoals: (ownerId: string) => api.get<Goal[]>(`/sharing/user/${ownerId}/goals`),
  }
}

export type SharingApi = ReturnType<typeof createSharingApi>
