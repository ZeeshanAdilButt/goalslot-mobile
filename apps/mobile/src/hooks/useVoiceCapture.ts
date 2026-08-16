// The microphone state machine, shared by both mic surfaces: the global one
// in the tab bar (app/(app)/voice.tsx) and the tracking-scoped one on the
// Time Tracker (src/components/voice/TrackerVoiceButton.tsx).
//
// It owns capture and nothing else. What a sentence MEANS is the caller's
// job, handed over through `onCommand` — that separation is what lets the
// two surfaces interpret the same words completely differently (open-ended
// Coach proposals vs. instant transport control) without a second copy of
// the permission, timeout, haptic, and announcement handling.
//
// Every state below is one the UI renders differently, and every transition
// fires a haptic and a screen-reader announcement. A voice interface gives
// no visual feedback to a user who is looking at their hands or nothing at
// all, so "did it hear me" has to be answerable without looking.

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking } from "react-native";

import type { VoiceCapability, VoiceError } from "@goalslot/shared";

import { hapticCompletion, hapticListenEnd, hapticListenStart, hapticWarning } from "@/lib/haptics";

/**
 * Hard ceiling on one listening session. The recognizer normally closes
 * itself after a pause in speech, but a wedged native session otherwise
 * leaves the mic indicator lit with no way back — the state this exists to
 * make impossible.
 *
 * Kept well above the recognizer's own silence tolerance (5s — see
 * SILENCE_TOLERANCE_MS in src/lib/speech-recognition.ts) so a person who
 * pauses to think doesn't get cut off by this failsafe before the silence
 * detection even has a chance to fire. This is a wedged-session backstop,
 * not the thing that decides when a normal pause ends the session.
 */
const MAX_LISTEN_MS = 60_000;

/** How long a success state stays up before the surface returns to rest. */
const SUCCESS_LINGER_MS = 2_200;

export type VoiceCaptureStatus =
  | "idle"
  | "listening"
  | "processing"
  | "success"
  | "error"
  | "permission-denied"
  | "unavailable";

export interface VoiceCaptureState {
  status: VoiceCaptureStatus;
  /** Live while listening, final while processing. Empty otherwise. */
  transcript: string;
  /** Rendered for 'success', 'error', 'permission-denied' and 'unavailable'. */
  message: string;
}

/**
 * What the caller did with the transcript.
 *
 * `handoff` is the important one: it means the caller is now rendering the
 * result itself (a proposal to confirm, a list of goals to choose from), so
 * the mic drops straight back to rest instead of flashing a success tick
 * over the top of a question it has just asked.
 */
export type VoiceCommandOutcome =
  | { kind: "done"; message: string }
  | { kind: "handoff" }
  | { kind: "failed"; message: string };

export interface UseVoiceCaptureOptions {
  voice: VoiceCapability;
  /** Runs once per session, with the committed transcript. */
  onCommand: (transcript: string) => Promise<VoiceCommandOutcome>;
  /** Prefixes every announcement, so a screen reader says which mic spoke. */
  label?: string;
}

export interface UseVoiceCaptureResult {
  state: VoiceCaptureState;
  /** Checks availability and permission, prompts if it may, then listens. */
  start: () => Promise<void>;
  /** Commit: close the mic and take the final transcript. */
  stop: () => Promise<void>;
  /** Back out: close the mic and discard whatever was said. */
  cancel: () => Promise<void>;
  /** Return to rest from a terminal state without starting again. */
  reset: () => void;
  /** Deep-links to the app's OS settings page. Only offered when denied. */
  openSettings: () => void;
  isBusy: boolean;
}

const IDLE: VoiceCaptureState = { status: "idle", transcript: "", message: "" };

function announce(message: string): void {
  if (message.length > 0) AccessibilityInfo.announceForAccessibility(message);
}

export function useVoiceCapture({ voice, onCommand, label }: UseVoiceCaptureOptions): UseVoiceCaptureResult {
  const [state, setState] = useState<VoiceCaptureState>(IDLE);

  // Refs, not state, for everything the async callbacks below have to read:
  // a native `result` event can land after the component re-rendered, and a
  // stale closure over `state` would then commit a transcript from the
  // session before it.
  const transcriptRef = useRef("");
  const settledRef = useRef(false);
  const mountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `onCommand` is typically an inline arrow in the caller, so it changes
  // identity every render. Reading it through a ref keeps `start` stable
  // (it is wired to a button's onPress) without asking every caller to
  // memoise.
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    if (lingerRef.current !== null) clearTimeout(lingerRef.current);
    timeoutRef.current = null;
    lingerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearTimers();
      // Leaving the screen must close the microphone. Cancel, not stop:
      // a transcript nobody is left to act on should be discarded, not
      // committed.
      void voice.cancelListening();
    };
  }, [clearTimers, voice]);

  const apply = useCallback(
    (next: VoiceCaptureState, spoken?: string) => {
      if (!mountedRef.current) return;
      setState(next);
      announce(spoken ?? next.message);
    },
    [],
  );

  const reset = useCallback(() => {
    clearTimers();
    transcriptRef.current = "";
    settledRef.current = false;
    if (mountedRef.current) setState(IDLE);
  }, [clearTimers]);

  /** Runs exactly once per session, whether it ended by commit, error or timeout. */
  const settle = useCallback(
    async (transcript: string) => {
      if (settledRef.current) return;
      settledRef.current = true;
      clearTimers();

      const trimmed = transcript.trim();
      if (trimmed.length === 0) {
        // Silence is an answer, not a failure — the recognizer worked, there
        // was just nothing to hear.
        hapticWarning();
        apply({
          status: "error",
          transcript: "",
          message: "Didn't catch that. Tap the mic and try again.",
        });
        return;
      }

      hapticListenEnd();
      apply({ status: "processing", transcript: trimmed, message: "" }, `Heard: ${trimmed}. Working on it.`);

      try {
        const outcome = await commandRef.current(trimmed);
        if (!mountedRef.current) return;

        if (outcome.kind === "handoff") {
          setState(IDLE);
          return;
        }
        if (outcome.kind === "failed") {
          hapticWarning();
          apply({ status: "error", transcript: trimmed, message: outcome.message });
          return;
        }

        hapticCompletion();
        apply({ status: "success", transcript: trimmed, message: outcome.message });
        lingerRef.current = setTimeout(() => {
          if (mountedRef.current) setState(IDLE);
        }, SUCCESS_LINGER_MS);
      } catch (err) {
        if (!mountedRef.current) return;
        hapticWarning();
        apply({
          status: "error",
          transcript: trimmed,
          message: err instanceof Error ? err.message : "Couldn't run that. Please try again.",
        });
      }
    },
    [apply, clearTimers],
  );

  const handleError = useCallback(
    (error: VoiceError) => {
      if (settledRef.current) return;
      settledRef.current = true;
      clearTimers();
      hapticWarning();
      apply({
        status: error.kind === "permission-denied" ? "permission-denied" : "error",
        transcript: "",
        message: error.message,
      });
    },
    [apply, clearTimers],
  );

  const start = useCallback(async () => {
    clearTimers();
    transcriptRef.current = "";
    settledRef.current = false;

    if (!(await voice.isAvailable())) {
      apply({
        status: "unavailable",
        transcript: "",
        message: "Speech recognition isn't available on this device. You can still type your request.",
      });
      return;
    }

    let permission = await voice.getPermission();
    if (permission === "undetermined") {
      // Asked here, at the moment the user pressed a microphone, rather than
      // at launch — the request only makes sense next to the thing that
      // needs it, and a cold prompt gets refused.
      permission = await voice.requestPermission();
    }
    if (permission !== "granted") {
      // Deliberately no retry loop. Once the OS has a "no" on file it never
      // shows the dialog again, so asking a second time does nothing except
      // teach the user the app is broken. Settings is the only real fix.
      apply({
        status: "permission-denied",
        transcript: "",
        message: "GoalSlot needs microphone access to hear you. Turn it on in Settings, or type your request instead.",
      });
      return;
    }

    hapticListenStart();
    apply({ status: "listening", transcript: "", message: "" }, `${label ? `${label}. ` : ""}Listening`);

    timeoutRef.current = setTimeout(() => {
      void voice.stopListening();
      // stopListening asks the recognizer for a final result, but a wedged
      // session may never deliver one — settle on what we have so the UI
      // cannot be stranded in 'listening'.
      void settle(transcriptRef.current);
    }, MAX_LISTEN_MS);

    await voice.startListening({
      onTranscript: (text, isFinal) => {
        transcriptRef.current = text;
        if (isFinal) {
          void settle(text);
          return;
        }
        // Interim text is display-only. Guarding on `settledRef` keeps a
        // late partial from reopening a session that already committed.
        if (!settledRef.current && mountedRef.current) {
          setState((current) =>
            current.status === "listening" ? { ...current, transcript: text } : current,
          );
        }
      },
      onError: handleError,
      onEnd: () => {
        // The recognizer closed on its own (silence, or the user stopped
        // talking) without ever sending a final result.
        void settle(transcriptRef.current);
      },
    });
  }, [apply, clearTimers, handleError, label, settle, voice]);

  const stop = useCallback(async () => {
    await voice.stopListening();
  }, [voice]);

  const cancel = useCallback(async () => {
    settledRef.current = true;
    clearTimers();
    await voice.cancelListening();
    if (mountedRef.current) setState(IDLE);
  }, [clearTimers, voice]);

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  return {
    state,
    start,
    stop,
    cancel,
    reset,
    openSettings,
    isBusy: state.status === "listening" || state.status === "processing",
  };
}
