// Resolves the messaging service URLs out of app config, and is the single
// place anything asks "is messaging on in this build?".
//
// Both URLs come from `expoConfig.extra`, populated by app.config.js from
// EXPO_PUBLIC_MESSAGING_URL / EXPO_PUBLIC_MESSAGING_WS_URL (see that file).
// They are frequently absent — the service is deployed separately from the
// GoalSlot API — so "unset" is a normal state, not an error, and the whole
// feature has to be inert rather than broken when it happens:
//
//   * `messagingEnabled` is false, so the (app) layout doesn't register the
//     routes and the drawer doesn't list them;
//   * the service client still constructs, but every call rejects with a
//     MessagingError of kind 'not-configured' rather than hitting undefined/…;
//   * the socket stays 'idle' and never opens.
//
// Nothing here throws. A misconfigured build must degrade to "no Messages
// tab", never to a crash on launch.

import Constants from "expo-constants";

function readExtra(key: string): string | null {
  const value = Constants.expoConfig?.extra?.[key];
  // Guards against the two real-world shapes of "not set": absent, and
  // present-but-empty (an env var exported as "").
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : null;
}

/** https://host -> wss://host. Mirrors app.config.js so a runtime-only override still works. */
function deriveWsUrl(httpUrl: string | null): string | null {
  if (!httpUrl) return null;
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice("https://".length)}`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice("http://".length)}`;
  return null;
}

const httpUrl = readExtra("messagingUrl");
const wsUrl = readExtra("messagingWsUrl") ?? deriveWsUrl(httpUrl);

/** Whether the Messages feature exists at all in this build. */
export const messagingEnabled = httpUrl !== null;

/** Whether live delivery is possible. False = polling/refetch only, not an error. */
export const messagingLiveEnabled = messagingEnabled && wsUrl !== null;

export function getMessagingHttpUrl(): string | undefined {
  return httpUrl ?? undefined;
}

export function getMessagingWsUrl(): string | undefined {
  return wsUrl ?? undefined;
}
