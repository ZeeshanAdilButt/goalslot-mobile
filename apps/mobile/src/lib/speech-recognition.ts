// The real `VoiceCapability` (packages/shared/src/capabilities), backed by
// `expo-speech-recognition` — SFSpeechRecognizer on iOS, android.speech's
// SpeechRecognizer on Android.
//
// WHY THIS LIBRARY, not @react-native-voice/voice (the more obvious pick):
//
//  1. This app runs the New Architecture (app.json `newArchEnabled: true`,
//     React Native 0.86). @react-native-voice/voice@3.2.4 ships no
//     `codegenConfig` — it is a legacy bridge module reaching us only
//     through the interop shim, and its published devDependencies still
//     target react-native ^0.56. expo-speech-recognition is written against
//     the Expo Modules API, which is New Architecture native.
//  2. Its bundled Expo config plugin depends on `@expo/config-plugins@^2`
//     (Expo SDK 41 era). Adding it to an SDK 57 app pulls a config-plugins
//     major from five years ago into `expo prebuild`.
//  3. Android 11+ package visibility. `SpeechRecognizer` silently reports
//     unavailable unless the manifest declares a `<queries>` entry for the
//     `android.speech.RecognitionService` intent. expo-speech-recognition's
//     plugin writes that (plus RECORD_AUDIO and both iOS usage strings);
//     with the other library it is a manual step that fails quietly on a
//     device you did not test on.
//  4. On-device recognition (`requiresOnDeviceRecognition`) is a first-class
//     option, which is what "speech capture on-device" in the brief asks
//     for and what keeps a user's spoken goals off a cloud endpoint when
//     the device can handle it.
//
// Known trade-off, stated plainly: the published line is 56.x, tracking
// Expo SDK 56, and this app is on SDK 57. Its peer range is `expo: *`, JS
// export/bundling is unaffected (verified — `expo export` passes), but the
// native build should be re-verified when an SDK 57 release lands.
//
// EVERY native call below is behind `loadModule()`. The module is resolved
// lazily with require() rather than a top-level import for one specific
// reason: `expo export` and the Jest suite both evaluate this file in a
// plain Node process with no native runtime attached, and a top-level
// import of an Expo module throws there. Failing to load is not an error
// state — it is `isAvailable() === false`, which the UI already renders as
// "voice isn't available on this device".

import { Platform } from "react-native";

import type {
  VoiceCapability,
  VoiceError,
  VoiceErrorKind,
  VoiceListenHandlers,
  VoicePermissionStatus,
} from "@goalslot/shared";

/**
 * The slice of `expo-speech-recognition` this file uses. Declared locally
 * (rather than imported) so the lazy require above stays type-safe without
 * a top-level import of the module it is deliberately not importing.
 */
interface SpeechRecognitionNativeModule {
  start(options: Record<string, unknown>): void;
  stop(): void;
  abort(): void;
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean; status: string }>;
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean; status: string }>;
  addListener(event: string, listener: (payload: never) => void): { remove(): void };
}

interface ResultEvent {
  isFinal: boolean;
  results: { transcript: string }[];
}

interface ErrorEvent {
  error: string;
  message: string;
}

/**
 * How long the recognizer waits after speech stops before deciding the
 * person is done talking. People pause mid-thought while journaling or
 * talking to Coach far more than the OS's own default silence window (often
 * ~1-2s) allows for — this is the app's answer to "give me a beat to think"
 * rather than treating a thinking pause as the end of the utterance.
 *
 * Android exposes this as a tunable `RecognizerIntent` extra (set below).
 * iOS's `SFSpeechRecognizer` has no equivalent per-call option in this
 * library — its end-of-speech detection is opaque and not tunable from JS,
 * so this constant only takes effect on Android; iOS keeps the OS's own
 * (shorter, uncontrollable) silence detection.
 */
const SILENCE_TOLERANCE_MS = 5_000;

let cached: SpeechRecognitionNativeModule | null | undefined;

function loadModule(): SpeechRecognitionNativeModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition") as {
      ExpoSpeechRecognitionModule?: SpeechRecognitionNativeModule;
    };
    cached = mod.ExpoSpeechRecognitionModule ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Platform error codes -> the six kinds the UI renders differently, with the
 * sentence each one shows. Written as user-facing copy here, at the one
 * place that knows what actually went wrong, rather than leaving each screen
 * to invent its own wording for "no-speech".
 */
const ERROR_COPY: Record<VoiceErrorKind, string> = {
  "permission-denied": "GoalSlot needs microphone access to hear you. You can turn it on in Settings.",
  "no-speech": "Didn't catch that. Try again and speak right after the tone.",
  unavailable: "Speech recognition isn't available on this device.",
  network: "Speech recognition needs a connection right now, and there isn't one.",
  audio: "Couldn't use the microphone. Close anything else that might be recording and try again.",
  unknown: "Something went wrong while listening. Please try again.",
};

export function voiceErrorFromCode(code: string): VoiceError {
  const kind = mapErrorCode(code);
  return { kind, message: ERROR_COPY[kind] };
}

function mapErrorCode(code: string): VoiceErrorKind {
  switch (code) {
    case "not-allowed":
      return "permission-denied";
    case "no-speech":
    case "speech-timeout":
      return "no-speech";
    case "service-not-allowed":
    case "language-not-supported":
    case "bad-grammar":
      return "unavailable";
    case "network":
      return "network";
    case "audio-capture":
    case "interrupted":
    case "busy":
      return "audio";
    default:
      return "unknown";
  }
}

function toPermissionStatus(response: { granted: boolean; canAskAgain: boolean }): VoicePermissionStatus {
  if (response.granted) return "granted";
  // `canAskAgain` is the only thing separating "hasn't been asked" from
  // "said no". Getting this wrong in either direction is a real bug: treat
  // an unasked permission as denied and the user is sent to Settings for no
  // reason; treat a denial as unasked and the app re-prompts forever against
  // an OS that will never show the dialog again.
  return response.canAskAgain ? "undetermined" : "denied";
}

/**
 * iOS reports its recognizer as available before the locale's model is
 * ready, and Android's availability check is meaningless without the
 * manifest `<queries>` entry the config plugin adds. Neither is worth
 * special-casing beyond asking the module.
 */
export function createSpeechRecognitionCapability(): VoiceCapability {
  let session: { remove(): void }[] = [];
  let active = false;

  const teardown = (): void => {
    for (const subscription of session) subscription.remove();
    session = [];
    active = false;
  };

  return {
    async isAvailable() {
      const module = loadModule();
      if (module === null) return false;
      try {
        return module.isRecognitionAvailable();
      } catch {
        return false;
      }
    },

    async getPermission() {
      const module = loadModule();
      if (module === null) return "undetermined";
      try {
        return toPermissionStatus(await module.getPermissionsAsync());
      } catch {
        return "undetermined";
      }
    },

    async requestPermission() {
      const module = loadModule();
      if (module === null) return "undetermined";
      try {
        return toPermissionStatus(await module.requestPermissionsAsync());
      } catch {
        return "denied";
      }
    },

    async startListening(handlers: VoiceListenHandlers) {
      const module = loadModule();
      if (module === null) {
        handlers.onError?.({ kind: "unavailable", message: ERROR_COPY.unavailable });
        handlers.onEnd?.();
        return;
      }

      // A second start against a live recognizer throws "busy" on Android
      // and silently drops the first session on iOS. Own the lifecycle here
      // so no caller has to.
      if (active) {
        try {
          module.abort();
        } catch {
          /* the recognizer was already gone */
        }
        teardown();
      }

      let ended = false;
      const finish = (): void => {
        if (ended) return;
        ended = true;
        teardown();
        handlers.onEnd?.();
      };

      session = [
        module.addListener("result", (event: never) => {
          const { isFinal, results } = event as ResultEvent;
          const transcript = results[0]?.transcript ?? "";
          handlers.onTranscript(transcript, isFinal);
        }),
        module.addListener("error", (event: never) => {
          const { error } = event as ErrorEvent;
          // An explicit abort() is how `cancelListening` works; surfacing it
          // as a failure would flash an error banner every time someone
          // backs out of the sheet.
          if (error === "aborted") return;
          handlers.onError?.(voiceErrorFromCode(error));
        }),
        module.addListener("end", () => finish()),
      ];

      active = true;

      try {
        module.start({
          lang: "en-US",
          // Shown live while speaking. iOS only emits these before it
          // commits; Android emits them throughout.
          interimResults: true,
          maxAlternatives: 1,
          // Punctuation would have to be stripped again before matching a
          // goal name, so don't ask for it.
          addsPunctuation: false,
          // One utterance per press. Continuous listening would keep the
          // mic hot after the command was given, which is both a battery
          // cost and a thing users are right to be uneasy about.
          continuous: false,
          // Keep audio on the device when the device can do it. Falls back
          // to the network recognizer automatically when it cannot, which is
          // why this is not gated on `supportsOnDeviceRecognition()`.
          requiresOnDeviceRecognition: Platform.OS === "ios",
          // Stretch the silence window that ends a session — see
          // SILENCE_TOLERANCE_MS above. Android-only: iOS has no matching
          // option on this module.
          ...(Platform.OS === "android"
            ? {
                androidIntentOptions: {
                  EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_TOLERANCE_MS,
                  // Prevents the endpointer cutting off during a shorter
                  // mid-speech pause than the full silence window above.
                  EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_TOLERANCE_MS,
                },
              }
            : {}),
        });
      } catch {
        handlers.onError?.({ kind: "unknown", message: ERROR_COPY.unknown });
        finish();
      }
    },

    async stopListening() {
      const module = loadModule();
      if (module === null || !active) return;
      try {
        // stop() asks for a final result; the `end` event still arrives and
        // is what tears the listeners down.
        module.stop();
      } catch {
        teardown();
      }
    },

    async cancelListening() {
      const module = loadModule();
      if (module === null || !active) {
        teardown();
        return;
      }
      try {
        module.abort();
      } finally {
        teardown();
      }
    },
  };
}
