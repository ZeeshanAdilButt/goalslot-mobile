// No import of `describe`/`it`/`expect` — see src/lib/deep-links.test.ts for
// why (no @types/jest; this file is excluded from `tsc --noEmit`).
//
// The recognizer's error vocabulary is a dozen platform codes, and the UI
// renders six outcomes. Getting that mapping wrong is not a crash, it is
// worse: a "no speech detected" shown as "microphone access denied" sends
// the user into Settings to fix a permission that was never off.

import { createSpeechRecognitionCapability, voiceErrorFromCode } from "./speech-recognition";

describe("voiceErrorFromCode", () => {
  it("routes a refusal to the permission state, which is the only one offering Settings", () => {
    expect(voiceErrorFromCode("not-allowed").kind).toBe("permission-denied");
  });

  it("treats both platforms' silence codes as no-speech, not as a failure", () => {
    // Android reports "speech-timeout" where iOS reports "no-speech". Both
    // mean the same thing to a user: say it again.
    expect(voiceErrorFromCode("no-speech").kind).toBe("no-speech");
    expect(voiceErrorFromCode("speech-timeout").kind).toBe("no-speech");
  });

  it("groups the three 'this device can't' codes as unavailable", () => {
    expect(voiceErrorFromCode("service-not-allowed").kind).toBe("unavailable");
    expect(voiceErrorFromCode("language-not-supported").kind).toBe("unavailable");
    expect(voiceErrorFromCode("bad-grammar").kind).toBe("unavailable");
  });

  it("groups the microphone-in-use cases as an audio problem", () => {
    expect(voiceErrorFromCode("audio-capture").kind).toBe("audio");
    expect(voiceErrorFromCode("interrupted").kind).toBe("audio");
    expect(voiceErrorFromCode("busy").kind).toBe("audio");
  });

  it("keeps the network case distinct — retrying is pointless without a connection", () => {
    expect(voiceErrorFromCode("network").kind).toBe("network");
  });

  it("falls back to unknown for a code it has never seen", () => {
    expect(voiceErrorFromCode("client").kind).toBe("unknown");
    expect(voiceErrorFromCode("some-future-code").kind).toBe("unknown");
  });

  it("always carries a sentence written for a person, never a bare code", () => {
    for (const code of ["not-allowed", "no-speech", "network", "audio-capture", "nonsense"]) {
      const { message } = voiceErrorFromCode(code);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain(code);
    }
  });
});

describe("createSpeechRecognitionCapability without a native module", () => {
  // This is what `expo export`, CI, and any device without a recognizer see.
  // It has to degrade to "unavailable", not throw — the tab and the tracker
  // both render a mic before they know whether one exists.
  it("reports itself unavailable rather than throwing", async () => {
    const voice = createSpeechRecognitionCapability();
    await expect(voice.isAvailable()).resolves.toBe(false);
  });

  it("reports permission as undetermined, so no UI sends the user to Settings", async () => {
    const voice = createSpeechRecognitionCapability();
    await expect(voice.getPermission()).resolves.toBe("undetermined");
  });

  it("ends the session immediately instead of leaving a caller listening forever", async () => {
    const voice = createSpeechRecognitionCapability();
    const onTranscript = jest.fn();
    const onError = jest.fn();
    const onEnd = jest.fn();

    await voice.startListening({ onTranscript, onError, onEnd });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "unavailable" }));
    expect(onEnd).toHaveBeenCalled();
  });

  it("stopping and cancelling an inactive session are both safe", async () => {
    const voice = createSpeechRecognitionCapability();
    await expect(voice.stopListening()).resolves.toBeUndefined();
    await expect(voice.cancelListening()).resolves.toBeUndefined();
  });
});
