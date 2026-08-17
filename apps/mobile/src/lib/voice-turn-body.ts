/**
 * Decides what the body of one Voice turn renders, given everything the
 * screen knows about that turn.
 *
 * THE INVARIANT THIS EXISTS TO HOLD: a finished turn is never blank. Before
 * this function, `voice.tsx` rendered its reply bubble behind a bare
 * `parsed.cleaned.length > 0` check and its proposal cards behind
 * `visibleProposals.length > 0`, with nothing underwriting the case where
 * both are empty. That case is reachable and a user hit it:
 *
 *   1. The Coach is told the prose around a ```coach-proposal block is
 *      OPTIONAL ("you MAY add 1-2 sentences", and for large requests "at
 *      most ONE short sentence" — coach-ai.service.ts). A block-only reply
 *      is well-formed, and `cleaned` for it is "".
 *   2. So the proposal card is the ENTIRE visible assistant turn.
 *   3. The user taps Apply. The change really is made.
 *   4. The card's only remaining control is "Done", which reads as "I've
 *      seen it" but is wired to `dismissProposal` — it removes the card.
 *   5. `visibleProposals` empties, and the turn renders "You said …" and
 *      absolutely nothing else. The dock falls through to "Tap the mic to
 *      ask something else", so the screen believes it is finished.
 *
 * The user is left with no confirmation that anything happened, which is
 * nearly as bad as failing: they cannot tell a silent success from a silent
 * failure. (Coach's screen never had this bug — coach.tsx renders the same
 * card with NO `onDismiss`, so its applied confirmation is permanent.)
 *
 * Two rules follow, and both live here rather than in JSX so they can be
 * tested:
 *
 *   - `proposalCount` is the count of proposals the reply PARSED, not the
 *     count still un-dismissed. Dismissing a card must not be able to empty
 *     the turn body.
 *   - `appliedNotice` is the apply result lifted OUT of `CoachProposalCard`'s
 *     own `useState`, where it used to be the only copy. Anything that
 *     unmounts the card — "Done", a dismissal, a remount — took the only
 *     record of what the Coach just did with it.
 */

export interface VoiceTurnBody {
  /**
   * Prose for the reply bubble. Empty ONLY when the turn is still streaming
   * or when `interrupted` is set — never for a settled turn that has
   * something to say.
   */
  replyText: string;
  /** Show the "Preparing a change…" placeholder. */
  showPending: boolean;
  /** Show the "that block produced no card" failure notice plus its retry. */
  showUnrenderable: boolean;
  /** The stream ended without ever producing anything renderable. */
  interrupted: boolean;
}

export interface VoiceTurnBodyInput {
  /** `extractCoachProposals(...).cleaned` — the reply with fenced blocks stripped. */
  cleaned: string;
  /** `extractCoachProposals(...).proposals.length` — NOT the visible count. */
  proposalCount: number;
  /** `extractCoachProposals(...).pending` — a fence is still open. */
  pending: boolean;
  /** `extractCoachProposals(...).unrenderable !== null`. */
  unrenderable: boolean;
  /** The turn is still receiving tokens. */
  streaming: boolean;
  /** The lifted result of applying this turn's proposals, if it was applied. */
  appliedNotice: string | null;
}

/**
 * Defensive against inputs this screen should never produce but has: a
 * non-string `cleaned` from a malformed cache entry, a negative or
 * fractional count, a whitespace-only notice. None of these should throw or
 * render a blank turn.
 */
function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function describeVoiceTurnBody(input: VoiceTurnBodyInput): VoiceTurnBody {
  const cleaned = textOf(input?.cleaned);
  const proposalCount = countOf(input?.proposalCount);
  const appliedNotice = textOf(input?.appliedNotice);
  const streaming = input?.streaming === true;
  const pending = input?.pending === true;
  const unrenderable = input?.unrenderable === true;

  // "Preparing a change…" is a STREAMING placeholder. Once the stream has
  // ended, an open fence means the reply was cut off mid-block, not that
  // something is still on its way — leaving the placeholder up then is a
  // spinner that never resolves.
  const showPending = pending && streaming;
  // Never flashed mid-reply: prose can legitimately arrive after a closed
  // block that produced no card, so a turn that hasn't finished arriving
  // must not show a failure it may still recover from.
  const showUnrenderable = unrenderable && !streaming;

  let replyText = "";
  if (cleaned.length > 0) {
    replyText = cleaned;
  } else if (proposalCount > 0) {
    // A block-only reply. The card carries the detail, so this only has to
    // stop the turn reading as though the Coach said nothing at all.
    replyText =
      proposalCount === 1
        ? "Here's the change I've prepared."
        : `Here are the ${proposalCount} changes I've prepared.`;
  } else if (appliedNotice.length > 0) {
    // No prose and no proposals left to describe, but something was applied
    // from this turn — say what.
    replyText = appliedNotice;
  }

  const interrupted = !streaming && replyText.length === 0 && !showUnrenderable;

  return { replyText, showPending, showUnrenderable, interrupted };
}

/** The copy for `interrupted`, kept beside the flag that selects it. */
export const VOICE_TURN_INTERRUPTED_TEXT =
  "That got interrupted before I could answer. Tap the mic to try again.";
