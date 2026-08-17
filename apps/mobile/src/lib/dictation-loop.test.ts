// No import of describe/it/expect — Jest globals, same as note-content.test.ts
// and every other test in this directory.

import {
  MAX_SILENCE_MS,
  isBlockedStatus,
  isSilentSettle,
  nextSilenceState,
  shouldRestartCapture,
} from "./dictation-loop";

describe("shouldRestartCapture", () => {
  it("reopens the mic once a session settles back to idle mid-run", () => {
    expect(shouldRestartCapture("listening", true, "idle")).toBe(true);
  });

  it("does not reopen once the run has been stopped", () => {
    // The ordering that matters: `stop()` flips captureActive false BEFORE
    // the in-flight settle resolves to idle. If this returned true anyway,
    // tapping "Stop listening" would be immediately undone by the chain.
    expect(shouldRestartCapture("listening", false, "idle")).toBe(false);
  });

  it("does not reopen while a session is still in flight", () => {
    expect(shouldRestartCapture("listening", true, "listening")).toBe(false);
    expect(shouldRestartCapture("listening", true, "processing")).toBe(false);
  });

  it("does not reopen from any mode other than listening", () => {
    for (const mode of ["inactive", "priming", "blocked", "soft-stopped"] as const) {
      expect(shouldRestartCapture(mode, true, "idle")).toBe(false);
    }
  });
});

describe("isSilentSettle", () => {
  it("treats an empty-transcript error as a pause, not a failure", () => {
    expect(isSilentSettle("error", "")).toBe(true);
  });

  it("does not treat a failure that heard something as silence", () => {
    // This is the "the phrase arrived but writing it into the note failed"
    // case — it must NOT be silently retried as if nobody spoke.
    expect(isSilentSettle("error", "buy milk")).toBe(false);
  });

  it("is false for every non-error status", () => {
    for (const status of ["idle", "listening", "processing", "success", "permission-denied", "unavailable"] as const) {
      expect(isSilentSettle(status, "")).toBe(false);
    }
  });
});

describe("isBlockedStatus", () => {
  it("is terminal for permission-denied and unavailable only", () => {
    expect(isBlockedStatus("permission-denied")).toBe(true);
    expect(isBlockedStatus("unavailable")).toBe(true);
    expect(isBlockedStatus("error")).toBe(false);
    expect(isBlockedStatus("idle")).toBe(false);
  });
});

describe("nextSilenceState", () => {
  it("starts the streak clock on the first silent segment and retries", () => {
    expect(nextSilenceState(null, 1_000)).toEqual({ action: "retry", silenceStartedAt: 1_000 });
  });

  it("keeps retrying, and keeps the ORIGINAL streak start, inside the budget", () => {
    // The budget is elapsed time since the streak began — not restarted by
    // each retry, or a person pausing to think would never reach it.
    expect(nextSilenceState(1_000, 1_000 + MAX_SILENCE_MS - 1)).toEqual({
      action: "retry",
      silenceStartedAt: 1_000,
    });
  });

  it("soft-stops once the budget is exhausted", () => {
    expect(nextSilenceState(1_000, 1_000 + MAX_SILENCE_MS)).toEqual({
      action: "soft-stop",
      silenceStartedAt: null,
    });
  });

  it("is a time budget, not a retry count", () => {
    // Fifty silent segments inside one second still retry. This is the
    // property the whole design turns on: many short recognizer sessions in
    // quick succession are normal (each one is only a few seconds long), so
    // counting attempts would end dictation almost immediately.
    let silenceStartedAt: number | null = null;
    for (let i = 0; i < 50; i += 1) {
      const outcome = nextSilenceState(silenceStartedAt, 1_000 + i * 20);
      expect(outcome.action).toBe("retry");
      silenceStartedAt = outcome.silenceStartedAt;
    }
    expect(silenceStartedAt).toBe(1_000);
  });

  it("gives a fresh streak the whole budget again after speech was heard", () => {
    // A committed phrase resets the streak to null; the next pause therefore
    // starts from zero rather than inheriting elapsed time from earlier in
    // the same dictation run.
    const late = nextSilenceState(null, 10_000_000);
    expect(late).toEqual({ action: "retry", silenceStartedAt: 10_000_000 });
  });
});
