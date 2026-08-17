// Server-side notification history — the `Notification` table goal-slot-api
// already writes on every dispatch (ReminderDispatchService.createInAppNotification,
// unconditional on every dispatchToUser call) plus the feedback-reply path
// (NotificationsService.createFeedbackReplyNotification). This client is the
// first mobile consumer of it; matches
// goal-slot-api/src/modules/notifications/{notifications.controller,notifications.service}.ts
// field-for-field.
//
// `type` is left as a plain `string` rather than a closed union: the server's
// `NotificationType` enum is the source of truth and can grow independently
// of this client (see notification-policy.ts's exhaustiveness guard on that
// repo's side) — a mobile build that doesn't yet know about a new type should
// still render the row (title/body/timestamp) rather than fail to typecheck
// or silently drop it. `data`'s shape is likewise left as `unknown` at this
// layer; interpreting it is `resolveNotificationRoute`'s job
// (apps/mobile/src/lib/deep-links.ts), not this API client's.

import type { AxiosInstance } from 'axios'

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

/**
 * Which slice of the notification history a call is about.
 *
 *   'all'     — everything, including MESSAGE_RECEIVED.
 *   'general' — everything EXCEPT MESSAGE_RECEIVED.
 *
 * 'general' exists for the bell. A message arriving is already surfaced twice
 * on its own terms — as an unread conversation on the Messages icon (drawer
 * row + floating button, both derived from `countUnreadConversations`) and as
 * the push itself — so repeating it a third time in the bell feed both
 * double-counts and buries the notifications that have nowhere else to live
 * (a mentor's instruction, a shared report going stale, a release).
 *
 * The scope applies to `unreadCount` as much as to `items`, server-side. That
 * is the whole reason this is a server parameter rather than a `.filter()` on
 * the client: filtering here would leave the badge counting rows the list no
 * longer shows, and a cursor page could come back visibly empty while
 * `hasMore` was still true.
 *
 * An older server that predates this parameter ignores it and answers as
 * 'all' — the query is read off `@Query('scope')`, not a whitelisted DTO, so
 * an unknown value degrades to today's behaviour rather than a 400.
 */
export type NotificationScope = 'all' | 'general'

export interface NotificationListParams {
  cursor?: string
  limit?: number
  scope?: NotificationScope
}

/**
 * `unreadCount` is a snapshot of the FULL unread total for the requested
 * SCOPE (not just this page) as of this request — every page carries it,
 * which is what lets a screen or a bell badge read it off whichever page it
 * last fetched without a separate "just the count" endpoint.
 *
 * `scope` echoes back what the server actually applied. Optional because a
 * server older than the scope parameter doesn't send it; absent means "this
 * server didn't scope anything", i.e. treat it as 'all'.
 */
export interface NotificationListResponse {
  items: AppNotification[]
  nextCursor: string | null
  hasMore: boolean
  unreadCount: number
  scope?: NotificationScope
}

/**
 * `unreadCount` is always 0 — the call just cleared every unread row in that
 * scope, so it is 0 by construction and the server spends no extra query
 * proving it. Read the badge straight off this; do not follow up with a list
 * request.
 */
export interface MarkAllNotificationsReadResponse {
  updated: number
  scope: NotificationScope
  unreadCount: number
}

export function createNotificationsApi(api: AxiosInstance) {
  return {
    list: (params?: NotificationListParams) =>
      api.get<NotificationListResponse>('/notifications', { params }),
    // 404 if the id doesn't exist, 403 if it isn't the caller's own — both
    // surface as a normal thrown AxiosError, same as every other client here.
    markRead: (id: string) => api.patch<AppNotification>(`/notifications/${id}/read`),
    /**
     * Clears every unread notification in `scope` in ONE server-side
     * `updateMany` — never a loop of per-row PATCHes. A user with a hundred
     * unread rows must cost one statement, not a hundred round trips.
     *
     * `scope` MUST match the scope of the list the user is looking at. Marking
     * 'all' read from a bell that only ever showed 'general' would silently
     * clear message notifications the user never saw.
     */
    markAllRead: (scope: NotificationScope) =>
      api.patch<MarkAllNotificationsReadResponse>('/notifications/read-all', undefined, {
        params: { scope },
      }),
    // 404 if the id doesn't exist, 403 if it isn't the caller's own — same
    // ownership check as markRead, mirrored server-side
    // (notifications.service.ts's `delete`). 204/no body on success.
    delete: (id: string) => api.delete<void>(`/notifications/${id}`),
  }
}

export type NotificationsApi = ReturnType<typeof createNotificationsApi>
