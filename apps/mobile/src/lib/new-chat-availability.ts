// The one predicate behind the Coach/Voice header "+" ("Start a new chat"),
// shared by both screens so the button's VISIBILITY and its HANDLER can never
// disagree.
//
// Why this is a module and not two inline expressions: coach.tsx had them
// written out separately and they drifted. The handler bailed on
// `isReadOnly || persistedMessages.length === 0`; the render only checked
// `!isReadOnly`. So in every state where the conversation was empty the "+"
// rendered at full opacity, with accessibilityRole="button", no `disabled`,
// and a pressed style — and did nothing at all. No dialog, no toast, no
// haptic. There are four such states, and three of them are ones a user sits
// in and taps:
//
//   1. history still loading (the ThreadSkeleton is on screen) — the "+" is
//      the first thing tappable on entering the tab,
//   2. history failed to load (QueryErrorState is on screen),
//   3. a genuinely empty conversation — the EmptyState invites the user to
//      start talking while the "+" sits above it doing nothing,
//   4. mid-way through the FIRST message's stream, before the refetch lands.
//
// voice.tsx never had the bug because it gates render and handler on the same
// `hasAnswer`. This makes that structure explicit and shared rather than a
// coincidence of one screen being written more carefully than the other.
//
// The count to pass is the PERSISTED message count, not what is on screen:
// "New chat" archives the persisted turns and then clears them server-side,
// so a screen showing only an optimistic bubble and a half-streamed reply has
// nothing for it to act on yet. See coach.tsx's `canStartNewChat` for the
// full reasoning on why this is deliberately not `allMessages.length`.

export interface NewChatAvailability {
  /** Number of turns that are actually persisted server-side and would be archived + cleared. */
  messageCount: number;
  /**
   * Viewing an earlier week. "New chat" always targets the CURRENT week's
   * live conversation, never whatever is on screen, so it is not offered at
   * all here. Voice has no week-scrubbing UI and omits this.
   */
  isReadOnly?: boolean;
}

/**
 * Whether "Start a new chat" has anything to do. Callers MUST use this for
 * both the render gate and the handler guard — a "+" that is visible has to
 * do something when it is pressed.
 */
export function canStartNewChat({ messageCount, isReadOnly = false }: NewChatAvailability): boolean {
  if (isReadOnly) return false;
  return messageCount > 0;
}
