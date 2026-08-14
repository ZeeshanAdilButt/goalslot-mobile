// The three-tier voice routing decision — pure and synchronous, same reason
// tracking-commands.ts and note-commands.ts are: a judgement call about what
// a spoken command should DO belongs in one place that can be read in full
// and tested without a microphone or a network call, not scattered across
// the screen that renders the answer.
//
// THE THREE TIERS, and why each exists:
//
//   Tier 1 — packages/shared/src/voice/parse.ts's `parseVoiceCommand`.
//       Instant, zero-network, deterministic. Recognises a fixed, narrow set
//       of phrasings (start/stop/pause/resume tracking, log time, append a
//       note) with its own confidence scoring. This is the fast path: most
//       real commands are exactly one of these, said plainly.
//
//   Tier 2 — POST /coach/voice-intent (packages/shared/src/api/coach.ts).
//       Reached only when Tier 1 comes back UNKNOWN — i.e. `shouldEscalateToTier2`
//       below says yes. A single classification call, not a chat turn: much
//       cheaper and much faster than Tier 3, and wide enough to also catch
//       journal entries, task/goal creation and day-summary questions that
//       Tier 1's rule table never attempts. `routeVoiceIntentResponse` below
//       is what turns its answer into one of: run a tracking action, append
//       to today's journal, or fall through to Tier 3.
//
//   Tier 3 — the full Coach chat (apiClient.coach.streamChat). Unchanged by
//       any of this: anything neither tier above was willing to act on ends
//       up here, exactly as voice.tsx already handled every command before
//       this module existed.
//
// WHY APPEND_NOTE NEVER EXECUTES OUT OF TIER 2: the request context this
// module builds for /coach/voice-intent only ever carries goal/task
// candidates (see CoachVoiceIntentContext) — there is no note candidate list
// for the endpoint to match a page name against, and its response's `target`
// is typed to only ever be 'goal' | 'task' (see CoachVoiceIntentTarget).
// Structurally, then, an APPEND_NOTE classification can never come back with
// a page to write to. Rather than guess which page was meant — the one thing
// note-commands.ts's own header says this feature must never do — Tier 2's
// APPEND_NOTE (like CREATE_TASK/CREATE_GOAL/DAY_QUERY/CHAT/UNKNOWN) is routed
// to Tier 3, unchanged from how an unrecognised note command already fell
// through to the Coach before this module existed.
//
// WHY LOW CONFIDENCE ALWAYS FALLS THROUGH: Tier 2's classification is a
// single yes/no per utterance with no ranked runners-up to compare against
// (unlike Tier 1's target resolution, which can at least say "two things
// matched equally well"), so there is no ambiguity signal to show a "which
// one?" panel for. A 'low'-confidence read is only ever acted on by handing
// it to the Coach, which can ask a clarifying question in prose — the same
// "never guess, ask instead" rule this app already applies everywhere else a
// spoken word turns into a mutation.

import {
  isActionableVoiceIntent,
  type CoachVoiceIntentResponse,
  type VoiceIntent,
} from "@goalslot/shared";

/** True once Tier 1 has nothing to offer and the transcript should go to Tier 2. */
export function shouldEscalateToTier2(intent: VoiceIntent): boolean {
  return !isActionableVoiceIntent(intent);
}

export type VoiceIntentRoute =
  /** Run a tracking transport action. `target` is already resolved by the endpoint — no local fuzzy matching needed. */
  | { kind: "track"; action: "start" | "stop" | "pause" | "resume"; target: { kind: "goal" | "task"; id: string } | null }
  /** Append `text` to today's journal entry. No target to resolve — journal is one-entry-per-day. */
  | { kind: "journal"; text: string }
  /** Nothing here to act on directly. Hand the original transcript to the full Coach (Tier 3). */
  | { kind: "coach" };

/**
 * Turns a Tier 2 classification into what the mobile app should actually do.
 * Pure: given the same response, always the same route — see this module's
 * header for why APPEND_NOTE/CREATE_TASK/CREATE_GOAL/DAY_QUERY/CHAT/UNKNOWN
 * all land on 'coach', and why a 'low'-confidence read of anything is
 * treated the same way regardless of its `intent`.
 */
export function routeVoiceIntentResponse(response: CoachVoiceIntentResponse): VoiceIntentRoute {
  if (response.confidence !== "high") return { kind: "coach" };

  switch (response.intent) {
    case "START_TRACKING":
      return { kind: "track", action: "start", target: response.target };
    case "STOP_TRACKING":
      return { kind: "track", action: "stop", target: response.target };
    case "PAUSE":
      return { kind: "track", action: "pause", target: response.target };
    case "RESUME":
      return { kind: "track", action: "resume", target: response.target };
    case "APPEND_JOURNAL":
      // A classification with nothing to write is not a complete command —
      // same rule LOG_TIME's needsDuration and APPEND_NOTE's empty-content
      // check already apply at Tier 1 (see parse.ts).
      return response.text !== null && response.text.trim().length > 0
        ? { kind: "journal", text: response.text.trim() }
        : { kind: "coach" };
    case "APPEND_NOTE":
    case "CREATE_TASK":
    case "CREATE_GOAL":
    case "DAY_QUERY":
    case "CHAT":
    case "UNKNOWN":
    default:
      return { kind: "coach" };
  }
}
