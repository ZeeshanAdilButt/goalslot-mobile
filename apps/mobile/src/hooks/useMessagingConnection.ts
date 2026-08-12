// Subscribes a screen to the socket's status and the device's connectivity,
// which together decide what the offline banner says.
//
// Both are read through the app's existing single subscriptions
// (lib/messaging-live.ts for the socket, lib/offline.ts's NetInfo listener)
// rather than each screen opening its own — two NetInfo listeners can
// disagree for a tick, and this is the value the UI uses to tell the user
// whether their messages are getting through.

import { useEffect, useState } from "react";

import type { MessagingSocketStatus } from "@goalslot/shared";

import { getSocketStatus, subscribeToSocketStatus } from "@/lib/messaging-live";
import { isOnline, subscribeOnline } from "@/lib/offline";

export interface MessagingConnection {
  status: MessagingSocketStatus;
  online: boolean;
}

export function useMessagingConnection(): MessagingConnection {
  const [status, setStatus] = useState<MessagingSocketStatus>(() => getSocketStatus());
  const [online, setOnline] = useState<boolean>(() => isOnline());

  useEffect(() => {
    // `subscribeToSocketStatus` replays the current status on subscribe, so a
    // screen mounted after the socket opened doesn't sit on a stale 'idle'.
    const unsubscribeStatus = subscribeToSocketStatus(setStatus);
    const unsubscribeOnline = subscribeOnline(setOnline);
    return () => {
      unsubscribeStatus();
      unsubscribeOnline();
    };
  }, []);

  return { status, online };
}
