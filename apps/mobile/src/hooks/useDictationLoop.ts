// Continuous, hands-free dictation, layered on top of the one-shot
// src/hooks/useVoiceCapture.ts without changing it.
//
// useVoiceCapture is built for a SINGLE utterance: mic opens, one phrase,
// `settle()` fires `onCommand` once, mic returns to idle, and a 60s
// MAX_LISTEN_MS backstop closes a wedged session. Dictating a paragraph needs
// something else entirely — the mic has to feel continuously open across many
// sentences and across the thinking pauses between them. So, exactly as
// voice.tsx and TrackerVoiceButton layer their own semantics on the same
// shared hook, this hook composes an auto-restart loop on top of it: every
// time a session settles, `captureActiveRef` decides whether to `start()`
// again. That is what defeats the one-shot, 60s-capped design without
// touching it.
//
// Lifted from app/(app)/journal.tsx, which grew this loop first for "talk
// about my day" and is where its behaviour was tuned. It is a hook rather
// than a copy so the Notes editor's dictation cannot quietly drift into being
// a lesser version of the one the user already likes. NOTE: journal.tsx still
// runs its own inlined copy of this loop as of this commit — migrating it is a
// deliberately separate change, so a regression in a screen the user relies on
// can be reverted without taking Notes dictation down with it. Any behaviour
// change made here should be mirrored there until that migration lands.
//
// The pure decision rules (restart, silence budget, blocked) live in
// src/lib/dictation-loop.ts so they can be unit-tested directly; this file is
// the React wiring around them.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import type { VoiceCapability } from "@goalslot/shared";

import { useVoiceCapture, type VoiceCaptureState, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import {
  SOFT_STOP_NOTICE_MS,
  isBlockedStatus,
  isSilentSettle,
  nextSilenceState,
  shouldRestartCapture,
  type DictationMode,
} from "@/lib/dictation-loop";
import { getErrorMessage } from "@/lib/get-error-message";

export interface UseDictationLoopOptions {
  voice: VoiceCapability;
  /**
   * Writes one committed phrase into whatever the caller's writing surface
   * is. AWAITED inside the capture hook's `settle()`, which is what
   * serialises the appends: the next session cannot even start until this
   * resolves, so two phrases can never interleave over a read-modify-write.
   * Callers must therefore await their whole write, never fire-and-forget it.
   *
   * Rejecting is a real signal, not an edge case — it calmly ends the run and
   * shows the error message rather than dictating on into a void.
   */
  onPhrase: (transcript: string) => Promise<void>;
  /** Prefixes screen-reader announcements, so a user hears which mic spoke. */
  label: string;
  /**
   * Whether the writing surface can safely accept dictated text yet. `begin()`
   * parks in "priming" until this is true — the Journal waits on the day's
   * entry having resolved (dictating before it lands would let the fetch wipe
   * what was said), the Notes editor waits on the webview bridge reporting
   * ready (dictating into an uninitialised bridge hangs on `getHTML`).
   */
  ready: boolean;
  /** Readiness can never be reached (the surface failed to load) — drop out of
   *  "priming" rather than leaving "Getting ready to listen…" up forever. */
  readyFailed?: boolean;
}

export interface UseDictationLoopResult {
  mode: DictationMode;
  /** Priming or listening — i.e. the surface should treat itself as busy. */
  isDictating: boolean;
  /** Replaces the default "stopped listening" copy when a run ended because
   *  `onPhrase` rejected. Null for an ordinary silence soft-stop. */
  notice: string | null;
  voiceState: VoiceCaptureState;
  /** Start a run. Safe to call from a deep link and from a button alike. */
  begin: () => void;
  /** Explicit stop. Commits whatever is in flight (stop, not cancel). */
  stop: () => void;
  /** A fresh attempt from the "stopped listening" notice. */
  resume: () => void;
  /** Clear a blocked/soft-stopped notice without starting again. */
  dismiss: () => void;
  /** The user has tapped into the text surface: they want to type, so
   *  capture and manual editing become mutually exclusive. */
  stopForTyping: () => void;
  openSettings: () => void;
}

export function useDictationLoop({
  voice,
  onPhrase,
  label,
  ready,
  readyFailed = false,
}: UseDictationLoopOptions): UseDictationLoopResult {
  const [mode, setMode] = useState<DictationMode>("inactive");
  const [notice, setNotice] = useState<string | null>(null);

  /** True while the auto-restart chain should keep reopening the mic after
   *  each session settles. A ref, not state, because it is flipped false
   *  BEFORE any stop/cancel — a state update would land a render too late and
   *  the chain would race the mic back open. */
  const captureActiveRef = useRef(false);
  /** Wall-clock start of the current unbroken run of silent segments, or null.
   *  See `nextSilenceState` for what it means. */
  const silenceStartedAtRef = useRef<number | null>(null);
  const softStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `onPhrase` is typically an inline arrow at the call site, so reading it
  // through a ref keeps the command callback below stable.
  const onPhraseRef = useRef(onPhrase);
  onPhraseRef.current = onPhrase;

  const clearSoftStopTimer = useCallback(() => {
    if (softStopTimer.current) {
      clearTimeout(softStopTimer.current);
      softStopTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearSoftStopTimer(), [clearSoftStopTimer]);

  const handleVoiceCommand = useCallback(
    async (transcript: string): Promise<VoiceCommandOutcome> => {
      // A committed phrase means the mic is hearing fine — clear the silence
      // streak so an occasional pause later doesn't inherit elapsed time
      // toward the budget from earlier in the same run.
      silenceStartedAtRef.current = null;
      try {
        await onPhraseRef.current(transcript);
      } catch (err) {
        // End the run rather than keep talking into something that isn't
        // accepting the words. `captureActiveRef` is a ref so this takes
        // effect synchronously, before the `handoff` below returns the hook
        // to idle and the restart effect gets a chance to look.
        captureActiveRef.current = false;
        clearSoftStopTimer();
        setNotice(getErrorMessage(err, "Couldn't add what you said. Tap the mic to try again."));
        setMode("soft-stopped");
      }
      // 'handoff', not 'done': the words have already landed in the caller's
      // surface, so there is nothing for the capture hook's own success tick
      // to confirm — and flashing one after every sentence would be
      // exhausting over a multi-minute dictation.
      return { kind: "handoff" };
    },
    [clearSoftStopTimer],
  );

  const {
    state: voiceState,
    start: startVoice,
    stop: stopVoice,
    cancel: cancelVoice,
    reset: resetVoice,
    openSettings,
  } = useVoiceCapture({ voice, onCommand: handleVoiceCommand, label });

  const begin = useCallback(() => {
    clearSoftStopTimer();
    setNotice(null);
    setMode("priming");
  }, [clearSoftStopTimer]);

  // Leaving the screen must close the microphone. Always. Cancel, not stop:
  // nobody is left to confirm an odd trailing fragment landing unattended.
  // This matters more than the capture hook's own unmount cleanup on screens
  // that stay MOUNTED after back-navigation (the hidden-tab routes) — there,
  // unmount never fires on leaving, so blur is the only cleanup that runs.
  useFocusEffect(
    useCallback(
      () => () => {
        captureActiveRef.current = false;
        silenceStartedAtRef.current = null;
        clearSoftStopTimer();
        void cancelVoice();
        setMode("inactive");
        setNotice(null);
      },
      [cancelVoice, clearSoftStopTimer],
    ),
  );

  // priming -> listening, once the surface can actually take the text. Also
  // the fast path: when `ready` was already true at `begin()`, this fires on
  // the very next render and priming is never visibly shown.
  useEffect(() => {
    if (mode !== "priming" || !ready) return;
    captureActiveRef.current = true;
    silenceStartedAtRef.current = null;
    setMode("listening");
  }, [mode, ready]);

  useEffect(() => {
    if (mode !== "priming" || !readyFailed) return;
    setMode("inactive");
  }, [mode, readyFailed]);

  // The auto-restart chain — the single mechanism that reopens the mic, both
  // for the first open of a run and after every phrase or retried silence.
  useEffect(() => {
    if (!shouldRestartCapture(mode, captureActiveRef.current, voiceState.status)) return;
    void startVoice();
  }, [mode, startVoice, voiceState.status]);

  // A session that heard nothing: retry silently inside the time budget, then
  // give up calmly rather than looping the mic forever.
  useEffect(() => {
    if (mode !== "listening") return;
    if (!isSilentSettle(voiceState.status, voiceState.transcript)) return;

    const outcome = nextSilenceState(silenceStartedAtRef.current, Date.now());
    silenceStartedAtRef.current = outcome.silenceStartedAt;
    if (outcome.action === "retry") {
      // Back through the restart chain above via idle, rather than calling
      // start() here — one restart mechanism, not two racing ones.
      resetVoice();
      return;
    }

    captureActiveRef.current = false;
    resetVoice();
    setNotice(null);
    setMode("soft-stopped");
    clearSoftStopTimer();
    softStopTimer.current = setTimeout(() => {
      setMode((current) => (current === "soft-stopped" ? "inactive" : current));
    }, SOFT_STOP_NOTICE_MS);
  }, [clearSoftStopTimer, mode, resetVoice, voiceState.status, voiceState.transcript]);

  // permission-denied / unavailable mid-flow -> blocked. Terminal for this
  // run: no auto-retry, matching the capture hook's own reasoning.
  useEffect(() => {
    if (mode !== "priming" && mode !== "listening") return;
    if (!isBlockedStatus(voiceState.status)) return;
    captureActiveRef.current = false;
    setMode("blocked");
  }, [mode, voiceState.status]);

  const stop = useCallback(() => {
    captureActiveRef.current = false;
    setMode("inactive");
    setNotice(null);
    void stopVoice();
  }, [stopVoice]);

  const resume = useCallback(() => {
    clearSoftStopTimer();
    silenceStartedAtRef.current = null;
    resetVoice();
    setNotice(null);
    captureActiveRef.current = true;
    setMode("listening");
  }, [clearSoftStopTimer, resetVoice]);

  const dismiss = useCallback(() => {
    clearSoftStopTimer();
    resetVoice();
    setMode("inactive");
    setNotice(null);
  }, [clearSoftStopTimer, resetVoice]);

  // Deliberately reads `mode` from the render closure rather than through a
  // `setMode(current => ...)` updater: the branches below have side effects
  // (stopping the mic, clearing a timer), and a state updater must stay pure —
  // React invokes it twice under StrictMode, which would stop the mic twice.
  const stopForTyping = useCallback(() => {
    if (mode === "priming" || mode === "listening") {
      captureActiveRef.current = false;
      setMode("inactive");
      setNotice(null);
      void stopVoice();
      return;
    }
    if (mode === "blocked" || mode === "soft-stopped") {
      dismiss();
    }
  }, [dismiss, mode, stopVoice]);

  return {
    mode,
    isDictating: mode === "priming" || mode === "listening",
    notice,
    voiceState,
    begin,
    stop,
    resume,
    dismiss,
    stopForTyping,
    openSettings,
  };
}
