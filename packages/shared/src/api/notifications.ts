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

export interface NotificationListParams {
  cursor?: string
  limit?: number
}

/**
 * `unreadCount` is a snapshot of the FULL unread total (not just this page)
 * as of this request — every page carries it, which is what lets a screen
 * or a bell badge read it off whichever page it last fetched without a
 * separate "just the count" endpoint.
 */
export interface NotificationListResponse {
  items: AppNotification[]
  nextCursor: string | null
  hasMore: boolean
  unreadCount: number
}

export function createNotificationsApi(api: AxiosInstance) {
  return {
    list: (params?: NotificationListParams) =>
      api.get<NotificationListResponse>('/notifications', { params }),
    // 404 if the id doesn't exist, 403 if it isn't the caller's own — both
    // surface as a normal thrown AxiosError, same as every other client here.
    markRead: (id: string) => api.patch<AppNotification>(`/notifications/${id}/read`),
  }
}

export type NotificationsApi = ReturnType<typeof createNotificationsApi>
