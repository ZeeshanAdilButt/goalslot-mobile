// Assembles the shared messaging pieces against this app's api client and
// config. Split out from `./queries` and `./offline` so both can import the
// service client without either importing the other (offline.ts registers a
// replayable send, queries.ts builds the query factory, and both need the
// same single client instance).
//
// Constructing these is unconditional and side-effect-free even when
// messaging is unconfigured: the token store never fires until something
// calls it, and the service client resolves its base URL per request and
// rejects with kind 'not-configured' when there isn't one. That's what lets
// the module be imported from the app's dependency graph without a guard —
// see ./messaging-config.ts.

import { createMessagingServiceClient, createMessagingTokenStore } from "@goalslot/shared";

import { apiClient } from "./api-client";
import { getMessagingHttpUrl } from "./messaging-config";

export const messagingTokenStore = createMessagingTokenStore({
  fetchToken: async () => {
    // Goes through the normal authenticated axios instance, so it inherits
    // the 401-refresh-and-retry interceptor: an expired *GoalSlot* session
    // refreshes transparently here rather than surfacing as a messaging
    // failure.
    const response = await apiClient.messaging.issueToken();
    return response.data;
  },
});

export const messagingClient = createMessagingServiceClient({
  getBaseUrl: getMessagingHttpUrl,
  getToken: (options) => messagingTokenStore.getToken(options),
});
