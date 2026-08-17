// Registers this device for REMOTE push, which is what makes "someone sent
// you a message" reach a phone that isn't open.
//
// WHY this file exists: the API's push pipeline was complete and the mobile
// app's half was missing entirely. `reminder-dispatch.service.ts` writes an
// in-app Notification row and fans out to its channels; the Expo channel
// queries `PushSubscription` rows where `kind = 'EXPO'` and sends to each
// one. Nothing in this app had ever called `getExpoPushTokenAsync`, so that
// query matched zero rows for every user. The dispatch "succeeded" every
// time — it found nobody to send to, which is not an error — and no push
// ever left the server. Everything looked wired because everything WAS
// wired, except the one step that tells the server where the device is.
//
// Shape follows journal-reminders.ts / schedule-reminders.ts: pure functions
// over an injected port, no React and no module-level singletons, so the
// whole thing is testable without mocking expo-notifications, axios or
// AsyncStorage. `createPushRegistrationPort()` is the only place the real
// implementations are named.
//
// EVERY function here swallows its failures. Push registration is background
// housekeeping that runs on the app-start path — a device that is offline,
// an emulator with no push support, or a build with no push credentials must
// produce a no-op, never a crash and never an error UI. All of those are
// normal states, and the next launch retries.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

import type { NotificationPermissionStatus } from "@goalslot/shared";

import { apiClient } from "./api-client";
import { createExpoNotificationCapability, getExpoPushToken } from "./notifications";
import { secureTokenStorage } from "./secure-token-storage";

/** Matches the `goalslot-*` naming the zustand-persisted stores already use. */
const STORAGE_KEY = "goalslot-push-registration";

/**
 * What we remember about the registration we last completed on this device.
 *
 * `userId` is part of it because the server keys a subscription by (user,
 * token): the same physical phone signed into a second account is a second,
 * legitimately separate row. Remembering only the token would make an
 * account switch look like "already registered" and leave the new account
 * unreachable.
 *
 * `subscriptionId` is the whole reason this is persisted rather than kept in
 * memory — it is what `unregisterPushRegistration` needs on sign-out, and
 * sign-out can happen in a process that never ran the registration.
 */
export interface StoredPushRegistration {
  userId: string;
  expoToken: string;
  subscriptionId: string;
}

/**
 * The outcome of a sync attempt. Returned (rather than logged and dropped)
 * so tests can assert the branch taken and callers could surface it later —
 * today nothing renders it, by design: see the "swallows its failures" note
 * above.
 */
export type PushRegistrationResult =
  /** A new or rotated token was accepted by the API. */
  | "registered"
  /** Same user, same token, already registered — nothing sent. */
  | "unchanged"
  /** Notification permission isn't granted, so there is no token to get. */
  | "permission-not-granted"
  /** No EAS project id in app config — `getExpoPushTokenAsync` cannot be called. */
  | "no-project-id"
  /** Simulator, offline, or a build with no push credentials provisioned. */
  | "no-token"
  /** The API rejected or never received the registration. */
  | "failed";

export interface PushRegistrationPort {
  /**
   * Whether there is a session to make an authenticated request with.
   *
   * Load-bearing on the sign-out path, and specifically on the EXPIRED-
   * session flavour of it. `createApiClient`'s 401 interceptor clears the
   * stored tokens and then calls `onSessionExpired()`, which this app wires
   * to `logout()` — so by the time logout withdraws the subscription, the
   * tokens are already gone. Firing the DELETE anyway would 401, re-enter
   * that same interceptor, find no refresh token, and call
   * `onSessionExpired()` -> `logout()` a second time: a re-entrant sign-out
   * that fires a duplicate "Your session has expired" toast and re-runs the
   * whole session reset. Checking first turns that into a clean no-op.
   */
  hasAccessToken(): Promise<boolean>;
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  /** Resolves null when a token genuinely can't be had — see notifications.ts. */
  getExpoPushToken(): Promise<string | null>;
  register(expoToken: string): Promise<{ id: string }>;
  unregister(subscriptionId: string): Promise<void>;
  readStored(): Promise<StoredPushRegistration | null>;
  writeStored(value: StoredPushRegistration | null): Promise<void>;
}

/**
 * The EAS project id, which `getExpoPushTokenAsync` requires to mint a token
 * scoped to this project. Present in app.json as `extra.eas.projectId`;
 * read defensively because a bare `expo start` without EAS config, or a
 * stripped manifest, legitimately has neither.
 */
export function getEasProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const projectId = extra?.eas?.projectId;
  return typeof projectId === "string" && projectId.trim().length > 0 ? projectId.trim() : null;
}

export function createPushRegistrationPort(): PushRegistrationPort {
  const notifications = createExpoNotificationCapability();

  return {
    async hasAccessToken() {
      return (await secureTokenStorage.getAccessToken()) !== null;
    },

    getPermissionStatus: () => notifications.getPermissionStatus(),

    async getExpoPushToken() {
      const projectId = getEasProjectId();
      if (!projectId) return null;
      return getExpoPushToken(projectId);
    },

    async register(expoToken) {
      const response = await apiClient.pushSubscriptions.registerExpo(expoToken);
      return { id: response.data.id };
    },

    async unregister(subscriptionId) {
      await apiClient.pushSubscriptions.unregister(subscriptionId);
    },

    async readStored() {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isStoredPushRegistration(parsed) ? parsed : null;
      } catch {
        // A hand-edited or truncated value is indistinguishable from "never
        // registered", and treating it as such self-heals on the next sync.
        return null;
      }
    },

    async writeStored(value) {
      if (value === null) await AsyncStorage.removeItem(STORAGE_KEY);
      else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
  };
}

function isStoredPushRegistration(value: unknown): value is StoredPushRegistration {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.expoToken === "string" &&
    typeof candidate.subscriptionId === "string"
  );
}

/**
 * Brings this device's registration in line with the signed-in user.
 *
 * Deliberately DOES NOT prompt for notification permission. It only acts on
 * a permission the user has already granted, because this runs on the
 * app-start path and a permission dialog on launch — before anyone has asked
 * for anything — is the classic way to get permanently denied. The app
 * already has two places that ask deliberately (the first schedule reminder,
 * and Settings -> Notifications); both call this straight afterwards, so a
 * grant registers immediately rather than waiting for the next launch.
 *
 * Safe and cheap to call repeatedly. The API upserts on (userId, expoToken),
 * so a duplicate POST could never create a duplicate row; the stored-token
 * comparison is here to skip a pointless network round-trip on every single
 * launch, and it re-registers on its own whenever the token rotates or the
 * signed-in account changes.
 */
export async function syncPushRegistration(
  userId: string,
  port: PushRegistrationPort,
): Promise<PushRegistrationResult> {
  try {
    const permission = await port.getPermissionStatus();
    if (permission !== "granted") return "permission-not-granted";

    if (!getEasProjectId()) return "no-project-id";

    const expoToken = await port.getExpoPushToken();
    if (!expoToken) return "no-token";

    const stored = await port.readStored();
    if (stored && stored.userId === userId && stored.expoToken === expoToken) {
      return "unchanged";
    }

    // A token rotation or an account switch leaves the PREVIOUS row pointing
    // at this same handset. Withdraw it first so the old account's messages
    // stop arriving here — the server would otherwise keep both rows and
    // happily deliver to a token that now belongs to somebody else's session.
    if (stored) await withdraw(stored, port);

    const subscription = await port.register(expoToken);
    await port.writeStored({ userId, expoToken, subscriptionId: subscription.id });
    return "registered";
  } catch (error) {
    console.warn("[push] could not sync push registration", error);
    return "failed";
  }
}

/**
 * App-start entry point: brings the Android notify channel and the push
 * token registration up together. `ensureNotifyChannel` is injected (rather
 * than importing notifications.ts's export directly) for the same reason
 * `PushRegistrationPort` is injected below — so this ordering/call-both
 * contract is assertable with a fake, without loading expo-notifications or
 * mounting app/_layout.tsx, which this repo's test suite never does (see
 * push-registration.test.ts).
 *
 * `ensureNotifyChannel` runs first and its failure is swallowed rather than
 * left to reject this whole call: every server-sent push (message,
 * instruction assigned, shared-report-unviewed, app-release) is stamped
 * with this exact Android channel id (see goal-slot-api's
 * ANDROID_NOTIFY_CHANNEL_ID), and FCM silently drops any notification
 * referencing a channel id Android has never had `createNotificationChannel`
 * called for — so a fresh install, or any install where the user has only
 * ever used the "Alarm"/"Off" tiers for their own schedule blocks, would
 * otherwise never have this channel created and would never receive a
 * single server push. Previously this channel was only ever created lazily,
 * the first time a local "notify"-tier schedule reminder scheduled — which
 * left exactly that gap. A channel-creation hiccup must not, in turn, ever
 * block token registration - the two are independent capabilities.
 */
export async function runPushStartup(
  userId: string,
  port: PushRegistrationPort,
  ensureNotifyChannel: () => Promise<void>,
): Promise<PushRegistrationResult> {
  try {
    await ensureNotifyChannel();
  } catch (error) {
    console.warn("[push] could not ensure the Android notify channel", error);
  }

  return syncPushRegistration(userId, port);
}

/**
 * Withdraws this device's subscription. Called on sign-out, BEFORE the auth
 * tokens are cleared — the DELETE is an authenticated request, so the order
 * matters: run it after the tokens are gone and it 401s, leaving the row in
 * place and the previous account's messages landing on a phone that is now
 * signed into a different account, or none at all.
 */
export async function unregisterPushRegistration(port: PushRegistrationPort): Promise<void> {
  try {
    const stored = await port.readStored();
    if (!stored) return;

    // An expired session has already had its tokens cleared by the time
    // logout runs — see `hasAccessToken` above for why firing the DELETE
    // anyway causes a re-entrant sign-out. Drop the local record so the next
    // sign-in starts clean, and leave the server row for the Expo channel's
    // own `DeviceNotRegistered` pruning.
    if (!(await port.hasAccessToken())) {
      await port.writeStored(null);
      return;
    }

    await withdraw(stored, port);
  } catch (error) {
    console.warn("[push] could not unregister push registration", error);
  }
}

/**
 * Drops the server row and the local record of it. The local record is
 * cleared even when the server call fails: a 404 (already gone) and a 403
 * (not ours) are both terminal, and for anything else keeping a stale
 * subscription id around would only make the next sync retry a delete that
 * cannot succeed. Losing the id costs at most one orphaned row, which the
 * Expo channel prunes itself once the token stops resolving
 * (`DeviceNotRegistered` handling in expo-push-channel.provider.ts).
 *
 * The local record is cleared BEFORE the network call, not after. Since the
 * record is discarded either way the ordering doesn't change the outcome,
 * but it does bound re-entrancy: if the DELETE's own failure handling ever
 * routes back into sign-out (see `hasAccessToken`), the second pass finds
 * nothing stored and stops, instead of issuing the same doomed request again.
 */
async function withdraw(
  stored: StoredPushRegistration,
  port: PushRegistrationPort,
): Promise<void> {
  await port.writeStored(null);
  try {
    await port.unregister(stored.subscriptionId);
  } catch (error) {
    console.warn("[push] could not remove the previous push subscription", error);
  }
}
