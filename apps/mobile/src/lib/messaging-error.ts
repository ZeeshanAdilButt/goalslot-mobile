// Turns a failed `POST /messaging/conversations` into copy a screen can show,
// used by every place that opens (or reuses) a conversation from someone
// else's profile — mentees.tsx, mentee/[id].tsx, and NewConversationSheet.
//
// Before this existed, only NewConversationSheet routed through the shared
// `toMessagingError` classifier; the other two hand-rolled the same
// status-403-means-forbidden / no-response-means-offline check with their own
// wording, which is how they ended up telling the user "You're offline.
// Check your connection and try again." for the exact failure
// NewConversationSheet already described as "Couldn't reach messaging. Check
// your connection." — two different sentences for one situation, depending
// only on which screen happened to be open. Routing every call site through
// `toMessagingError` is what keeps that from drifting again; each caller
// still decides for itself whether to show the result inline or as a toast.

import { toMessagingError, type MessagingErrorKind } from "@goalslot/shared";

export interface CreateConversationErrorInfo {
  kind: MessagingErrorKind;
  message: string;
}

/**
 * `personName` only matters for the `forbidden` kind — the sharing graph is
 * per-person, so that's the one failure worth naming who it's about. Every
 * other kind uses the classifier's own generic wording.
 */
export function describeCreateConversationError(err: unknown, personName: string): CreateConversationErrorInfo {
  const messagingError = toMessagingError(err);
  return {
    kind: messagingError.kind,
    message:
      messagingError.kind === "forbidden"
        ? `You can't message ${personName} — that sharing connection isn't active any more.`
        : messagingError.message,
  };
}
