// The client half of `POST /api/push-subscriptions` — the route that turns a
// device into something the server can actually reach.
//
// WHY this file exists: the API has had a complete server-side push pipeline
// for a while (reminder-dispatch fans a notification out to every registered
// channel, and the Expo channel reads `PushSubscription` rows where
// `kind = 'EXPO'`), but nothing on mobile ever created one of those rows.
// The dispatch ran, found zero subscriptions for the user, and returned
// successfully — so every "new message" push was sent into an empty set.
// Registration is the missing half, not the delivery.
//
// The API's DTO (goal-slot-api/src/modules/push-subscriptions/dto/) accepts
// EITHER a web push subscription (endpoint + p256dh + auth) OR an Expo
// token, never both — the service rejects a payload carrying both shapes
// with a 400. Only the Expo shape is exposed here: this package's consumers
// that need push are the native apps, and web push registration is the web
// app's own concern with a different (browser-minted) credential.

import type { AxiosInstance } from 'axios'

/** Mirrors the API's `PushSubscriptionKind` enum. */
export type PushSubscriptionKind = 'WEB' | 'EXPO'

/**
 * A registered device, as returned by the register call. The `id` is the
 * only field callers actually need: it's what `unregister` takes, and
 * holding onto it is how a client can withdraw *this device's* subscription
 * on sign-out without disturbing the same user's other devices.
 */
export interface PushSubscriptionResponse {
  id: string
  userId: string
  kind: PushSubscriptionKind
  /** Web push only — always null for an Expo subscription. */
  endpoint: string | null
  /** Expo only — always null for a web push subscription. */
  expoToken: string | null
  createdAt: string
}

export function createPushSubscriptionsApi(api: AxiosInstance) {
  return {
    /**
     * Registers (or re-confirms) an Expo push token for the signed-in user.
     *
     * Safe to call repeatedly: the API upserts on the `userId_expoToken`
     * compound unique, so the same device re-registering on every launch
     * updates one row rather than accumulating duplicates. That's also why
     * the client-side dedupe in the mobile app is an optimisation to avoid
     * a redundant request, not a correctness requirement.
     *
     * Note the row is keyed by (user, token), so the SAME physical device
     * signed into two accounts legitimately produces two rows — one per
     * user. That is correct, and it is exactly why sign-out should call
     * `unregister` rather than leaving the previous account's row pointing
     * at a phone somebody else is now holding.
     */
    registerExpo: (expoToken: string) =>
      api.post<PushSubscriptionResponse>('/push-subscriptions', { expoToken }),

    /**
     * Removes a single subscription by id. The API scopes the delete to the
     * calling user (403 if the row belongs to somebody else) and 404s if it
     * has already gone, so callers should treat both as "already handled"
     * rather than as a failure worth surfacing.
     */
    unregister: (id: string) =>
      api.delete<PushSubscriptionResponse>(`/push-subscriptions/${id}`),
  }
}
