// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed, so this
// file is excluded from `tsc --noEmit` via tsconfig.json's `exclude` rather
// than typed against jest's ambient globals. Same note as
// src/lib/deep-links.test.ts.
//
// What is being pinned here is the confirmation policy, not the wiring: which
// spoken commands are allowed to run without asking, which have to ask, and
// what happens when a name doesn't match anything. Those are the decisions
// that would quietly hurt a user if they changed by accident.

import { parseVoiceCommand, type TargetCandidate } from "@goalslot/shared";

import { buildTrackingCandidates, planTrackingCommand, type TrackingPlan } from "./tracking-commands";

const CANDIDATES: TargetCandidate[] = [
  { id: "goal_deen", name: "Deen", kind: "goal" },
  { id: "goal_fitness", name: "Fitness", kind: "goal" },
  { id: "task_invoices", name: "Invoices", kind: "task" },
];

function plan(
  transcript: string,
  timerStatus: "idle" | "running" | "paused",
  candidates: TargetCandidate[] = CANDIDATES,
): TrackingPlan {
  return planTrackingCommand({ intent: parseVoiceCommand(transcript), timerStatus, candidates });
}

describe("the four reversible commands run immediately", () => {
  it("starts, with the spoken goal attached", () => {
    const result = plan("start tracking my deen goal", "idle");
    expect(result.kind).toBe("run");
    if (result.kind !== "run") throw new Error("unreachable");
    expect(result.action).toBe("start");
    expect(result.target?.id).toBe("goal_deen");
    expect(result.message).toBe("Tracking Deen");
  });

  it("starts with nothing attached when nothing was named", () => {
    const result = plan("start", "idle");
    expect(result).toEqual({ kind: "run", action: "start", target: null, message: "Tracking started" });
  });

  it("stops, pauses and resumes without a confirmation step", () => {
    expect(plan("stop", "running").kind).toBe("run");
    expect(plan("pause", "running").kind).toBe("run");
    expect(plan("resume", "paused").kind).toBe("run");
  });

  it("ignores a redundant name on stop rather than trying to match it", () => {
    // There is only ever one session. Resolving "deen" here could only turn
    // an unambiguous command into "I couldn't find that".
    const result = plan("stop tracking my deen goal", "running");
    expect(result).toEqual({ kind: "run", action: "stop", target: null, message: "Stopped and saved" });
  });

  it("stops cleanly even when the spoken name matches nothing at all", () => {
    expect(plan("stop tracking woodworking", "running").kind).toBe("run");
  });
});

describe("commands that cannot apply right now change nothing", () => {
  it.each([
    ["stop", "idle" as const, "Nothing is being tracked right now."],
    ["pause", "idle" as const, "Nothing is running to pause."],
    ["pause", "paused" as const, "Already paused."],
    ["resume", "idle" as const, "There's no paused session to resume."],
    ["resume", "running" as const, "Already tracking."],
    ["start", "running" as const, "Already tracking. Say stop when you're done."],
  ])('"%s" while %s is refused with a reason', (said, status, message) => {
    expect(plan(said, status)).toEqual({ kind: "reject", message });
  });
});

describe("mid-session re-targeting", () => {
  it('reads "start tracking X" during a run as re-pointing it, not restarting', () => {
    // Stopping and restarting would split one stretch of work into two
    // entries and throw away everything before the user said it.
    const result = plan("start tracking fitness", "running");
    expect(result.kind).toBe("run");
    if (result.kind !== "run") throw new Error("unreachable");
    expect(result.action).toBe("retarget");
    expect(result.target?.id).toBe("goal_fitness");
  });

  it("re-targets a paused session too", () => {
    const result = plan("start tracking fitness", "paused");
    if (result.kind !== "run") throw new Error("unreachable");
    expect(result.action).toBe("retarget");
  });

  it('treats a bare "start" while paused as a resume', () => {
    const result = plan("start", "paused");
    expect(result).toEqual({ kind: "run", action: "resume", target: null, message: "Resumed" });
  });
});

describe("a name it cannot place is always asked about, never guessed", () => {
  it("offers the near misses when there are some", () => {
    const result = plan("start tracking deen study", "idle", [{ id: "goal_deen", name: "Deen", kind: "goal" }]);
    expect(result.kind).toBe("choose");
    if (result.kind !== "choose") throw new Error("unreachable");
    expect(result.candidates.map((c) => c.id)).toEqual(["goal_deen"]);
  });

  it("says what it heard and offers nothing when nothing is close", () => {
    const result = plan("start tracking woodworking", "idle");
    expect(result.kind).toBe("choose");
    if (result.kind !== "choose") throw new Error("unreachable");
    expect(result.heardName).toBe("woodworking");
    expect(result.candidates).toEqual([]);
  });

  it("never falls back to starting an unattributed timer", () => {
    // This is the bug that started the feature, said out loud: a goal the
    // user could not find. Silently timing nothing would reproduce it.
    const result = plan("start tracking woodworking", "idle");
    expect(result.kind).not.toBe("run");
  });

  it("asks even while the goal and task lists are still loading", () => {
    expect(plan("start tracking deen", "idle", []).kind).toBe("choose");
  });

  it("acts without asking once the name is a clear match", () => {
    expect(plan("start tracking dean", "idle").kind).toBe("run");
  });

  it("re-runs the command against a target the user picked, skipping the matcher", () => {
    const intent = parseVoiceCommand("start tracking woodworking");
    const result = planTrackingCommand({
      intent,
      timerStatus: "idle",
      candidates: CANDIDATES,
      forcedTarget: { id: "goal_deen", name: "Deen", kind: "goal", score: 1, matchedOn: "Deen" },
    });
    expect(result.kind).toBe("run");
    if (result.kind !== "run") throw new Error("unreachable");
    expect(result.target?.id).toBe("goal_deen");
  });
});

describe("logging time asks first", () => {
  it("confirms rather than writing the record", () => {
    const result = plan("log 30 minutes to deen", "idle");
    expect(result.kind).toBe("confirm-log");
    if (result.kind !== "confirm-log") throw new Error("unreachable");
    expect(result.minutes).toBe(30);
    expect(result.target?.id).toBe("goal_deen");
    expect(result.message).toBe("Log 30 min to Deen?");
  });

  it("still asks when no target was named", () => {
    const result = plan("log 30 minutes", "idle");
    expect(result.kind).toBe("confirm-log");
    if (result.kind !== "confirm-log") throw new Error("unreachable");
    expect(result.target).toBeNull();
  });

  it("asks which goal before it asks whether to log", () => {
    expect(plan("log 30 minutes to woodworking", "idle").kind).toBe("choose");
  });

  it("refuses a duration that is not a plausible session", () => {
    expect(plan("log 30 seconds to deen", "idle").kind).toBe("reject");
    expect(plan("log 30 hours to deen", "idle").kind).toBe("reject");
  });
});

describe("anything that isn't a tracking command goes to the assistant", () => {
  it.each([
    "move my study block to 7pm",
    "add a task to call the bank",
    "rename my fitness goal to health",
    "what did I work on yesterday",
  ])('"%s" escalates', (said) => {
    expect(plan(said, "running")).toEqual({ kind: "escalate" });
  });

  it("escalates rather than stopping when it hears cancel", () => {
    expect(plan("cancel", "running")).toEqual({ kind: "escalate" });
  });
});

describe("buildTrackingCandidates", () => {
  it("offers goals and tasks together", () => {
    const built = buildTrackingCandidates(
      [{ id: "g1", title: "Deen" }],
      [{ id: "t1", title: "Invoices", goal: null }],
    );
    expect(built).toEqual([
      { id: "g1", name: "Deen", kind: "goal" },
      { id: "t1", name: "Invoices", kind: "task" },
    ]);
  });

  it("lets a task be reached by its parent goal's name", () => {
    // "Start tracking deen" should find the work filed under Deen even when
    // no goal is called that.
    const built = buildTrackingCandidates([], [{ id: "t1", title: "Morning reading", goal: { title: "Deen" } }]);
    expect(built[0]?.aliases).toEqual(["Deen"]);
  });
});
