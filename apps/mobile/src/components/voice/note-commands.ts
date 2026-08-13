// What a spoken "add this to my X notes" command should actually DO, given
// the user's real pages and (once fetched) whether the resolved page can
// even be written to.
//
// Mirrors tracking-commands.ts's shape on purpose — same three-way pattern
// (escalate / reject / choose / confirm-and-run), same reason for it: a
// judgement call about someone's data belongs in one pure, synchronous place
// that can be read in full and tested without a microphone, not scattered
// across the screen that renders the answer.
//
// THE ONE DIFFERENCE FROM TRACKING: there is no immediate-run branch here at
// all. Every tracking transport command that is reversible by speech runs
// unasked; appending unreviewed spoken text to a page that outlives the
// session never does, for the same reason LOG_TIME does not — see
// AppendNoteIntent's doc comment in packages/shared/src/voice/intent.ts.

import {
  isNamedTarget,
  resolveSpokenTarget,
  type AppendNoteIntent,
  type ResolvedTarget,
  type TargetCandidate,
  type TargetResolution,
  type VoiceIntent,
} from "@goalslot/shared";

export type NotePlan =
  /** Not an APPEND_NOTE command. Hand the transcript to GoalSlot AI. */
  | { kind: "escalate" }
  /** Cannot apply as heard (no pages, or the resolved page is read-only). Say why; change nothing. */
  | { kind: "reject"; message: string }
  /** A name we will not guess at. Offer the ranked candidates, or none. */
  | {
      kind: "choose";
      heardName: string;
      candidates: readonly ResolvedTarget[];
      /** The command to re-run once the user picks. */
      intent: AppendNoteIntent;
    }
  /** Writes content into a page. Show it, wait for a press — never a bare 'run'. */
  | { kind: "confirm-append"; target: ResolvedTarget; content: string; message: string };

export interface PlanNoteCommandInput {
  intent: VoiceIntent;
  /** The user's real pages. Empty while the list is still loading. */
  candidates: readonly TargetCandidate[];
  /**
   * A page the user picked by hand out of a previous 'choose'. Skips name
   * resolution entirely — they have already told us which one, and running
   * the matcher again could only disagree with them.
   */
  forcedTarget?: ResolvedTarget;
}

function resolveIfNamed(
  intent: AppendNoteIntent,
  candidates: readonly TargetCandidate[],
): TargetResolution | null {
  if (!isNamedTarget(intent.target)) return null;
  return resolveSpokenTarget(intent.target, candidates);
}

export function planNoteCommand({ intent, candidates, forcedTarget }: PlanNoteCommandInput): NotePlan {
  if (intent.type !== "APPEND_NOTE") return { kind: "escalate" };

  if (candidates.length === 0) {
    return { kind: "reject", message: "You don't have any pages yet — create one first." };
  }

  const resolution = forcedTarget === undefined ? resolveIfNamed(intent, candidates) : null;

  if (forcedTarget === undefined) {
    // parseVoiceCommand never emits APPEND_NOTE without a resolved 'note'
    // NamedTarget (see splitContentAndTarget) — this only guards the type,
    // it is not a path a real transcript reaches.
    if (!isNamedTarget(intent.target)) {
      return { kind: "reject", message: "Which page? Say the page's name." };
    }
    if (resolution !== null && resolution.status !== "confident") {
      // Both "nothing matched" and "two pages matched equally well" land
      // here. The panel renders whatever candidates came back, including
      // none — never a silent fallback to the first page in the list.
      return {
        kind: "choose",
        heardName: intent.target.name,
        candidates: resolution.candidates,
        intent,
      };
    }
  }

  const target = forcedTarget ?? resolution?.target ?? null;
  if (target === null) {
    // Unreachable alongside the branches above, kept so `target` below is a
    // type-checked `ResolvedTarget` rather than a manual assertion.
    return { kind: "reject", message: "Couldn't find that page." };
  }

  return {
    kind: "confirm-append",
    target,
    content: intent.content,
    message: `Add "${intent.content}" to ${target.name}?`,
  };
}

/**
 * True once the resolved page turns out to be read-only (a share recipient's
 * copy — see NoteDetailResponse). Only knowable after the page's own detail
 * has been fetched, which candidates (title only, from the list endpoint)
 * do not carry — so unlike every other rejection above, the caller checks
 * this at confirm time, not while building the plan.
 */
export function rejectIfNoteReadOnly(readOnly: boolean): NotePlan | null {
  return readOnly ? { kind: "reject", message: "That page is read-only — ask the owner to add to it." } : null;
}

/**
 * The pages a spoken name can refer to. Title-only matching is enough for
 * v1 — unlike buildTrackingCandidates' task-under-goal aliasing, a page has
 * no comparable second name worth offering as an alias.
 */
export function buildNoteCandidates(notes: readonly { id: string; title: string }[]): TargetCandidate[] {
  return notes.map((note) => ({ id: note.id, name: note.title, kind: "note" as const }));
}
