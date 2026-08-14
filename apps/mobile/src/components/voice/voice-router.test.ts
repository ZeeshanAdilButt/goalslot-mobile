// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed, so this
// file is excluded from `tsc --noEmit` via tsconfig.json's `exclude` rather
// than typed against jest's ambient globals. Same note as
// tracking-commands.test.ts / note-commands.test.ts.
//
// What is being pinned here is the routing policy, not the wiring: which
// Tier 2 classifications are trusted enough to run unasked, and which always
// fall through to the Coach. Those are the decisions that would quietly
// misroute a command if they changed by accident.

import { parseVoiceCommand, type CoachVoiceIntentResponse } from "@goalslot/shared";

import { routeVoiceIntentResponse, shouldEscalateToTier2 } from "./voice-router";

function response(overrides: Partial<CoachVoiceIntentResponse>): CoachVoiceIntentResponse {
  return {
    intent: "UNKNOWN",
    confidence: "high",
    target: null,
    text: null,
    reasoning: "",
    ...overrides,
  };
}

describe("shouldEscalateToTier2", () => {
  it("does not escalate a command Tier 1 already understood", () => {
    expect(shouldEscalateToTier2(parseVoiceCommand("stop"))).toBe(false);
    expect(shouldEscalateToTier2(parseVoiceCommand("start tracking my deen goal"))).toBe(false);
  });

  it("escalates anything Tier 1 could not place", () => {
    expect(shouldEscalateToTier2(parseVoiceCommand("what should I focus on today"))).toBe(true);
    expect(shouldEscalateToTier2(parseVoiceCommand("add a task to call the bank"))).toBe(true);
  });
});

describe("routeVoiceIntentResponse", () => {
  it("routes the four tracking intents to 'track', target passed through untouched", () => {
    expect(routeVoiceIntentResponse(response({ intent: "START_TRACKING", target: { kind: "goal", id: "g1" } }))).toEqual({
      kind: "track",
      action: "start",
      target: { kind: "goal", id: "g1" },
    });
    expect(routeVoiceIntentResponse(response({ intent: "STOP_TRACKING", target: null }))).toEqual({
      kind: "track",
      action: "stop",
      target: null,
    });
    expect(routeVoiceIntentResponse(response({ intent: "PAUSE" }))).toEqual({ kind: "track", action: "pause", target: null });
    expect(routeVoiceIntentResponse(response({ intent: "RESUME" }))).toEqual({ kind: "track", action: "resume", target: null });
  });

  it("routes APPEND_JOURNAL to 'journal' with the trimmed text", () => {
    expect(routeVoiceIntentResponse(response({ intent: "APPEND_JOURNAL", text: "  had a great workout today  " }))).toEqual({
      kind: "journal",
      text: "had a great workout today",
    });
  });

  it("falls through to the Coach when APPEND_JOURNAL has nothing to write", () => {
    expect(routeVoiceIntentResponse(response({ intent: "APPEND_JOURNAL", text: null }))).toEqual({ kind: "coach" });
    expect(routeVoiceIntentResponse(response({ intent: "APPEND_JOURNAL", text: "   " }))).toEqual({ kind: "coach" });
  });

  it("never executes APPEND_NOTE directly — the request context carries no note candidates to resolve against", () => {
    expect(
      routeVoiceIntentResponse(response({ intent: "APPEND_NOTE", text: "milk", target: null })),
    ).toEqual({ kind: "coach" });
  });

  it("hands CREATE_TASK, CREATE_GOAL, DAY_QUERY, CHAT and UNKNOWN to the Coach", () => {
    for (const intent of ["CREATE_TASK", "CREATE_GOAL", "DAY_QUERY", "CHAT", "UNKNOWN"] as const) {
      expect(routeVoiceIntentResponse(response({ intent }))).toEqual({ kind: "coach" });
    }
  });

  it("never acts on a low-confidence read, whatever the intent", () => {
    expect(
      routeVoiceIntentResponse(response({ intent: "START_TRACKING", confidence: "low", target: { kind: "goal", id: "g1" } })),
    ).toEqual({ kind: "coach" });
    expect(routeVoiceIntentResponse(response({ intent: "APPEND_JOURNAL", confidence: "low", text: "hi" }))).toEqual({
      kind: "coach",
    });
  });
});
