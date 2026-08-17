// The decision rules behind continuous, hands-free dictation — extracted from
// the effects in src/hooks/useDictationLoop.ts so the parts that are just
// arithmetic on (status, transcript, elapsed time) can be unit-tested the way
// every other pure module in src/lib is, instead of only through a rendered
// screen.
//
// Context for why any of this exists: src/hooks/useVoiceCapture.ts is built
// for a SINGLE utterance — the mic opens, one phrase arrives, `settle()` fires
// `onCommand` once, and the mic returns to idle. Dictating a paragraph needs
// the mic to feel continuously open across many sentences and across the
// thinking pauses between them, so an auto-restart loop is layered on top of
// that one-shot hook (see the hook's own header for the shape of the loop).
// These functions are the three judgement calls that loop has to make.

import type { VoiceCaptureStatus } from "@/hooks/useVoiceCapture";

/**
 * How long a run of *silent* segments is tolerated, in total elapsed
 * wall-clock time, before dictation gives up and says so.
 *
 * A TIME BUDGET, NOT A RETRY COUNT, and that distinction is the whole point:
 * the recognizer's own per-session silence tolerance (SILENCE_TOLERANCE_MS,
 * 5s — src/lib/speech-recognition.ts) closes a session after an ordinary
 * pause, which is indistinguishable from a person thinking about the next
 * sentence. Counting attempts would end dictation after a handful of normal
 * pauses; counting elapsed time since speech was last actually heard means a
 * long pause costs exactly what it costs and nothing more.
 */
export const MAX_SILENCE_MS = 45_000;

/** How long the "stopped listening" notice stays up before auto-clearing. */
export const SOFT_STOP_NOTICE_MS = 4_000;

/**
 * The dictation surface's own mode, layered above the capture hook's
 * `VoiceCaptureStatus`. The hook's status describes one microphone session;
 * this describes the whole dictation run the user thinks they are in.
 */
export type DictationMode = "inactive" | "priming" | "listening" | "blocked" | "soft-stopped";

/**
 * Whether the mic should be reopened right now.
 *
 * True exactly when a run is meant to still be going (`listening` +
 * `captureActive`) and the capture hook has dropped back to rest. That single
 * condition covers both the very first open of a run and every restart after
 * a phrase commits or a silent segment is retried — one restart mechanism
 * rather than two racing ones.
 *
 * `captureActive` is passed in (rather than derived from `mode`) because the
 * loop flips it synchronously, via a ref, BEFORE any stop/cancel — a React
 * state update would land a render too late and the chain would race the mic
 * back open after the user asked it to stop.
 */
export function shouldRestartCapture(
  mode: DictationMode,
  captureActive: boolean,
  status: VoiceCaptureStatus,
): boolean {
  return mode === "listening" && captureActive && status === "idle";
}

/**
 * Whether a settled session heard nothing at all.
 *
 * A session that ends empty reaches the capture hook as
 * `{ status: 'error', transcript: '' }` whether it was plain silence
 * (`settle()`'s own short-circuit) or a genuine recognizer error with nothing
 * heard yet (`handleError` always clears the transcript). Both mean the same
 * thing mid-dictation — "nobody said anything this time" — and both are
 * retried rather than surfaced, because the hook's own "Didn't catch that"
 * copy reads as a failure when it is usually just a pause.
 *
 * An error with a NON-empty transcript is a different animal (something was
 * heard but handling it failed) and deliberately does not match here.
 */
export function isSilentSettle(status: VoiceCaptureStatus, transcript: string): boolean {
  return status === "error" && transcript === "";
}

/** Terminal for the run: no auto-retry, matching useVoiceCapture's own
 *  "deliberately no retry loop" reasoning — once the OS has a "no" on file it
 *  never shows the dialog again. */
export function isBlockedStatus(status: VoiceCaptureStatus): boolean {
  return status === "permission-denied" || status === "unavailable";
}

export type SilenceOutcome =
  | { action: "retry"; silenceStartedAt: number }
  | { action: "soft-stop"; silenceStartedAt: null };

/**
 * Applies the silence budget to one silent settle.
 *
 * `silenceStartedAt` is the wall-clock time the current unbroken run of silent
 * segments began, or `null` when no streak is active — it is reset to `null`
 * on every committed phrase and whenever a fresh run starts, so it always
 * measures time-since-last-heard-speech rather than time-since-dictation-began.
 * A pause early in a long dictation therefore costs the later pauses nothing.
 */
export function nextSilenceState(silenceStartedAt: number | null, now: number): SilenceOutcome {
  const startedAt = silenceStartedAt ?? now;
  if (now - startedAt < MAX_SILENCE_MS) return { action: "retry", silenceStartedAt: startedAt };
  return { action: "soft-stop", silenceStartedAt: null };
}
