// See tracking-commands.test.ts's header — same reasoning applies here:
// pinning the confirmation policy (never a bare 'run' for an append,
// always ask by name before guessing a page), not the wiring.

import { parseVoiceCommand, type TargetCandidate } from "@goalslot/shared";

import { buildNoteCandidates, planNoteCommand, rejectIfNoteReadOnly, type NotePlan } from "./note-commands";

const CANDIDATES: TargetCandidate[] = [
  { id: "note_shopping", name: "Shopping", kind: "note" },
  { id: "note_journal", name: "Journal", kind: "note" },
  { id: "note_shopping_dup", name: "Shopping", kind: "note" },
];

function plan(transcript: string, candidates: TargetCandidate[] = CANDIDATES): NotePlan {
  return planNoteCommand({ intent: parseVoiceCommand(transcript), candidates });
}

describe("anything that isn't APPEND_NOTE escalates to the Coach unchanged", () => {
  it.each([
    "start tracking my deen goal",
    "add a task to call the bank",
    "move my study block to 7pm",
    // The disambiguator itself: no explicit note-kind word, so this never
    // becomes APPEND_NOTE in the first place — parseVoiceCommand already
    // reads it as UNKNOWN, and planNoteCommand only ever sees 'escalate'.
    "add milk to my shopping",
  ])('"%s" escalates', (said) => {
    expect(plan(said)).toEqual({ kind: "escalate" });
  });
});

describe("an append always confirms before writing", () => {
  it("never returns a bare 'run' — writing unreviewed spoken text is confirmed, like LOG_TIME", () => {
    const result = plan("add milk to my journal notes");
    expect(result.kind).toBe("confirm-append");
  });

  it("carries the spoken content and the resolved page through to the confirmation", () => {
    const result = plan("add milk to my journal notes");
    if (result.kind !== "confirm-append") throw new Error("unreachable");
    expect(result.content).toBe("milk");
    expect(result.target.id).toBe("note_journal");
    expect(result.message).toBe('Add "milk" to Journal?');
  });

  it("keeps content containing the word 'to' intact rather than truncating at the first one", () => {
    const result = plan("add call mom back to my journal notes");
    if (result.kind !== "confirm-append") throw new Error("unreachable");
    expect(result.content).toBe("call mom back");
    expect(result.target.id).toBe("note_journal");
  });
});

describe("a page name it cannot place is always asked about, never guessed", () => {
  it("offers the near misses when there are some — including an exact duplicate title", () => {
    const result = plan("add milk to my shopping notes");
    expect(result.kind).toBe("choose");
    if (result.kind !== "choose") throw new Error("unreachable");
    expect(result.heardName).toBe("shopping");
    expect(result.candidates.map((c) => c.id)).toEqual(["note_shopping", "note_shopping_dup"]);
  });

  it("says what it heard and offers nothing when no page is close", () => {
    const result = plan("add milk to my woodworking notes");
    expect(result.kind).toBe("choose");
    if (result.kind !== "choose") throw new Error("unreachable");
    expect(result.heardName).toBe("woodworking");
    expect(result.candidates).toEqual([]);
  });

  it("never falls back to writing into an unattributed or wrong page", () => {
    const result = plan("add milk to my woodworking notes");
    expect(result.kind).not.toBe("confirm-append");
  });

  it("re-runs the command against a page the user picked, skipping the matcher", () => {
    const intent = parseVoiceCommand("add milk to my shopping notes");
    if (intent.type !== "APPEND_NOTE") throw new Error("unreachable");
    const result = planNoteCommand({
      intent,
      candidates: CANDIDATES,
      forcedTarget: { id: "note_journal", name: "Journal", kind: "note", score: 1, matchedOn: "Journal" },
    });
    expect(result.kind).toBe("confirm-append");
    if (result.kind !== "confirm-append") throw new Error("unreachable");
    expect(result.target.id).toBe("note_journal");
  });
});

describe("rejections", () => {
  it("refuses when there are no pages to add to at all", () => {
    expect(plan("add milk to my journal notes", [])).toEqual({
      kind: "reject",
      message: "You don't have any pages yet — create one first.",
    });
  });

  it("never plans an append with nothing to add — parseVoiceCommand already refused it upstream", () => {
    // "add to my shopping notes" has a connective and a valid page but no
    // content — parseVoiceCommand rejects it as UNKNOWN (see
    // parse.test.ts), so by the time it would reach here it is already an
    // 'escalate', same as any other utterance this rule doesn't recognise.
    expect(plan("add to my shopping notes")).toEqual({ kind: "escalate" });
  });
});

describe("rejectIfNoteReadOnly", () => {
  it("passes a writable page through untouched", () => {
    expect(rejectIfNoteReadOnly(false)).toBeNull();
  });

  it("refuses a read-only page with a clear reason, rather than attempting the write", () => {
    expect(rejectIfNoteReadOnly(true)).toEqual({
      kind: "reject",
      message: "That page is read-only — ask the owner to add to it.",
    });
  });
});

describe("buildNoteCandidates", () => {
  it("maps a note's title straight across, title-only matching for v1", () => {
    const built = buildNoteCandidates([
      { id: "n1", title: "Shopping" },
      { id: "n2", title: "Journal" },
    ]);
    expect(built).toEqual([
      { id: "n1", name: "Shopping", kind: "note" },
      { id: "n2", name: "Journal", kind: "note" },
    ]);
  });
});
