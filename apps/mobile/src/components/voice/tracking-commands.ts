// What a spoken tracking command should actually DO, given what the timer
// is currently doing and what the user's goals and tasks are called.
//
// Pure and synchronous on purpose. Every judgement call this feature makes
// about a user's time — is this reversible enough to run unasked, is that
// name close enough to act on, is there even a session to pause — is decided
// here, in one function, where it can be read in full and tested without a
// microphone. TrackerVoiceButton.tsx renders the answer and nothing else.
//
// THE CONFIRMATION SPLIT, which is the whole design:
//
//   start / stop / pause / resume  run immediately, no dialog
//       Each is undone by saying the opposite word. The cost of getting one
//       wrong is a few seconds of misattributed time; the cost of confirming
//       every one is that speaking is slower than pressing the button that
//       is already on screen, which makes the feature pointless. Immediacy
//       IS the feature.
//
//   log N minutes to X             confirms first
//       Writes a record with a duration nobody measured. Wrong by a misheard
//       digit and the user's reporting is quietly wrong until they notice.
//
//   an unrecognised name           always asks, never guesses
//       This is the case that started the work: a goal called "deen" the
//       user could not find. Starting an unattributed timer because we did
//       not recognise the name would reproduce that bug out loud.
//
//   anything not a tracking command  goes to the Coach, which confirms
//       "Move my study block to 7pm" is a real request and not this
//       component's business. It is handed to the assistant that already
//       parses, validates and confirms proposals.

import {
  isNamedTarget,
  resolveSpokenTarget,
  type ActionableVoiceIntent,
  type ResolvedTarget,
  type TargetCandidate,
  type TargetResolution,
  type VoiceIntent,
} from "@goalslot/shared";

import type { TimerStatus } from "@/lib/timer-store";

/** An immediately-runnable transport change. Every one is reversible by speech. */
export type TrackingAction = "start" | "retarget" | "stop" | "pause" | "resume";

export type TrackingPlan =
  /** Not a tracking command. Hand the transcript to GoalSlot AI. */
  | { kind: "escalate" }
  /** A tracking command that cannot apply right now. Say why; change nothing. */
  | { kind: "reject"; message: string }
  /** Run it now. `message` is both the on-screen confirmation and the announcement. */
  | { kind: "run"; action: TrackingAction; target: ResolvedTarget | null; message: string }
  /** A name we will not guess at. Offer the ranked candidates, or none. */
  | {
      kind: "choose";
      heardName: string;
      candidates: readonly ResolvedTarget[];
      /** The command to re-run once the user picks. */
      intent: ActionableVoiceIntent;
    }
  /** Writes a record. Show it, wait for a press. */
  | { kind: "confirm-log"; minutes: number; target: ResolvedTarget | null; message: string };

/** Sanity bounds on a spoken duration, matching what the API will accept. */
const MIN_LOG_MINUTES = 1;
const MAX_LOG_MINUTES = 24 * 60;

export interface PlanTrackingCommandInput {
  intent: VoiceIntent;
  timerStatus: TimerStatus;
  /** The user's real goals and tasks. Empty while the lists are still loading. */
  candidates: readonly TargetCandidate[];
  /**
   * A target the user picked by hand out of a previous 'choose'. Skips name
   * resolution entirely — they have already told us which one, and running
   * the matcher again could only disagree with them.
   */
  forcedTarget?: ResolvedTarget;
}

function targetLabel(target: ResolvedTarget | null): string {
  return target === null ? "" : ` ${target.name}`;
}

/**
 * Resolves a spoken name, or reports that the caller should ask. Returns
 * null when the intent named nothing at all, which is a complete command in
 * its own right — "start", with no target, is the one-tap start this screen
 * already offers a button for.
 */
function resolveIfNamed(
  intent: ActionableVoiceIntent,
  candidates: readonly TargetCandidate[],
): TargetResolution | null {
  if (!isNamedTarget(intent.target)) return null;
  return resolveSpokenTarget(intent.target, candidates);
}

export function planTrackingCommand({
  intent,
  timerStatus,
  candidates,
  forcedTarget,
}: PlanTrackingCommandInput): TrackingPlan {
  if (intent.type === "UNKNOWN") return { kind: "escalate" };

  // Stop, pause and resume never need a name. There is exactly one session,
  // so "stop tracking deen" and "stop" mean the same thing — and resolving
  // the redundant name would turn a perfectly clear command into "I couldn't
  // find deen" on the day the user renames that goal.
  if (intent.type === "STOP_TRACKING") {
    return timerStatus === "idle"
      ? { kind: "reject", message: "Nothing is being tracked right now." }
      : { kind: "run", action: "stop", target: null, message: "Stopped and saved" };
  }

  if (intent.type === "PAUSE") {
    if (timerStatus === "paused") return { kind: "reject", message: "Already paused." };
    return timerStatus === "running"
      ? { kind: "run", action: "pause", target: null, message: "Paused" }
      : { kind: "reject", message: "Nothing is running to pause." };
  }

  if (intent.type === "RESUME") {
    if (timerStatus === "running") return { kind: "reject", message: "Already tracking." };
    return timerStatus === "paused"
      ? { kind: "run", action: "resume", target: null, message: "Resumed" }
      : { kind: "reject", message: "There's no paused session to resume." };
  }

  const resolution = forcedTarget === undefined ? resolveIfNamed(intent, candidates) : null;
  if (resolution !== null && resolution.status !== "confident") {
    // Both "nothing matched" and "two things matched equally well" land here.
    // The panel renders whatever candidates came back, including none.
    return {
      kind: "choose",
      heardName: isNamedTarget(intent.target) ? intent.target.name : "",
      candidates: resolution.candidates,
      intent,
    };
  }
  const target = forcedTarget ?? resolution?.target ?? null;

  if (intent.type === "LOG_TIME") {
    // Bounds are checked against the raw value, not the rounded one: "log 30
    // seconds" is half a minute, and rounding first would turn it into a
    // perfectly valid one-minute entry the user never asked for.
    if (intent.durationMinutes < MIN_LOG_MINUTES) {
      return { kind: "reject", message: "That's under a minute — too short to log." };
    }
    const minutes = Math.round(intent.durationMinutes);
    if (minutes > MAX_LOG_MINUTES) {
      return { kind: "reject", message: "That's more than a day. Log it in smaller sessions." };
    }
    return {
      kind: "confirm-log",
      minutes,
      target,
      message: `Log ${minutes} min${target === null ? "" : ` to ${target.name}`}?`,
    };
  }

  // START_TRACKING.
  if (timerStatus === "idle") {
    return {
      kind: "run",
      action: "start",
      target,
      message: target === null ? "Tracking started" : `Tracking${targetLabel(target)}`,
    };
  }

  if (target !== null) {
    // "Actually I'm working on X" mid-session. Re-pointing the run is what
    // the user means — stopping and restarting would split one stretch of
    // work into two entries and lose the elapsed time from before they said
    // it.
    return {
      kind: "run",
      action: "retarget",
      target,
      message: `Now tracking${targetLabel(target)}`,
    };
  }

  // A bare "start" while paused is a resume in everything but wording, and
  // resuming is reversible. While running it is a no-op worth saying out
  // loud rather than silently restarting the clock at zero.
  return timerStatus === "paused"
    ? { kind: "run", action: "resume", target: null, message: "Resumed" }
    : { kind: "reject", message: "Already tracking. Say stop when you're done." };
}

/**
 * The goals and tasks a spoken name can refer to. Tasks carry their parent
 * goal's title as an alias so "start tracking deen" finds a task filed under
 * Deen when no goal by that name exists.
 */
export function buildTrackingCandidates(
  goals: readonly { id: string; title: string }[],
  tasks: readonly { id: string; title: string; goal?: { title?: string } | null }[],
): TargetCandidate[] {
  return [
    ...goals.map((goal) => ({ id: goal.id, name: goal.title, kind: "goal" as const })),
    ...tasks.map((task) => {
      const parent = task.goal?.title;
      return {
        id: task.id,
        name: task.title,
        kind: "task" as const,
        ...(parent ? { aliases: [parent] } : {}),
      };
    }),
  ];
}
