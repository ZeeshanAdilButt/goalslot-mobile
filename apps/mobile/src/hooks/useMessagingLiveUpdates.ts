// Lifecycle for the one messaging socket. Mounted once, from the (app)
// layout, so live updates keep the conversation list fresh from anywhere in
// the app rather than only while a messaging screen is open.
//
// Backgrounding is the whole reason this hook exists rather than a bare
// `connect()` at startup. A WebSocket held across a background/foreground
// cycle is usually already dead but not yet reported as such: iOS suspends
// the process and the socket's `onclose` may not fire until minutes after
// resume, during which the app silently receives nothing while believing it
// is connected. Closing on background and reconnecting on resume is both
// cheaper (no radio wake-ups for a socket nobody is watching) and more
// correct than trusting a stale handle.
//
// Android's 'inactive' state doesn't exist and iOS uses it for transient
// interruptions (the app switcher, a permission sheet, Control Center), which
// are NOT backgrounding — dropping the socket for those would reconnect
// several times a minute during normal use. Only 'background' disconnects.

import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { messagingEnabled, messagingLiveEnabled } from "@/lib/messaging-config";
import { messagingSocket, startMessagingConnectivityWatch } from "@/lib/messaging-live";
import { messagingQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";

export function useMessagingLiveUpdates(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !messagingEnabled || !messagingLiveEnabled) {
      return;
    }

    messagingSocket.connect();
    const stopConnectivityWatch = startMessagingConnectivityWatch();

    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        messagingSocket.connect();
        // Anything delivered while the socket was down is only in the
        // service's history, not the cache. Refetching the conversation list
        // on resume is what makes "come back to the app and see the new
        // message" work at all; the thread screen does the same for its own
        // messages on focus.
        void queryClient.invalidateQueries({ queryKey: messagingQueries.messagingQueries.conversations() });
        return;
      }
      if (state === "background") {
        messagingSocket.disconnect();
      }
    });

    return () => {
      subscription.remove();
      stopConnectivityWatch();
      // Signing out or unmounting the authenticated tree must not leave a
      // socket open under the old session's token.
      messagingSocket.disconnect();
    };
  }, [enabled]);
}
