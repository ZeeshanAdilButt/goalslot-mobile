// No import of `describe`/`it`/`expect`: see derive-online.test.ts's header
// comment — same reason, same exclusion via tsconfig.json.
import {
  describeVoiceTurnBody,
  VOICE_TURN_INTERRUPTED_TEXT,
  type VoiceTurnBodyInput,
} from "./voice-turn-body";

const base: VoiceTurnBodyInput = {
  cleaned: "",
  proposalCount: 0,
  pending: false,
  unrenderable: false,
  streaming: false,
  appliedNotice: null,
};

const body = (patch: Partial<VoiceTurnBodyInput> = {}) => describeVoiceTurnBody({ ...base, ...patch });

describe("describeVoiceTurnBody", () => {
  describe("the reported bug", () => {
    // The screenshot: "add a task to call the Bank" → block-only reply → the
    // card was the whole assistant turn → Apply → Done → nothing on screen.
    // The bubble keeps the introduction (the applied notice renders as its
    // own permanent row beneath, so it is not lost) — what matters is that
    // the turn is not wordless once the card is gone.
    it("still says something after the applied card has been dismissed", () => {
      const result = body({ proposalCount: 1, appliedNotice: "Change applied" });
      expect(result.replyText).toBe("Here's the change I've prepared.");
      expect(result.interrupted).toBe(false);
    });

    // And when the reply carried no parseable proposal at all, the applied
    // notice itself is the only thing left that can speak for the turn.
    it("falls back to the applied notice when there is nothing else to say", () => {
      expect(body({ appliedNotice: "Change applied" }).replyText).toBe("Change applied");
    });

    // The same turn one tap earlier: the card is on screen, but it is the
    // ONLY thing on screen, and the assistant appears to have said nothing.
    it("introduces a block-only reply instead of leaving the turn wordless", () => {
      expect(body({ proposalCount: 1 }).replyText).toBe("Here's the change I've prepared.");
    });

    it("counts the changes when a block-only reply carries several", () => {
      expect(body({ proposalCount: 3 }).replyText).toBe("Here are the 3 changes I've prepared.");
    });

    // The count must come from what PARSED, not from what is still visible,
    // or dismissing the cards empties the turn all over again.
    it("keeps the introduction after every card has been dismissed", () => {
      expect(body({ proposalCount: 2, appliedNotice: "2 changes applied" }).replyText).toBe(
        "Here are the 2 changes I've prepared.",
      );
    });

    it("reports a partial apply verbatim rather than a bare success", () => {
      expect(body({ appliedNotice: "3 of 4 changes applied. 1 couldn't be." }).replyText).toBe(
        "3 of 4 changes applied. 1 couldn't be.",
      );
    });
  });

  describe("the normal path is unchanged", () => {
    it("renders the model's prose when there is any", () => {
      expect(body({ cleaned: "Added it to Thursday." }).replyText).toBe("Added it to Thursday.");
    });

    it("prefers real prose over both the introduction and the applied notice", () => {
      const result = body({
        cleaned: "Added it to Thursday.",
        proposalCount: 2,
        appliedNotice: "2 changes applied",
      });
      expect(result.replyText).toBe("Added it to Thursday.");
    });

    it("shows nothing yet while a reply is still arriving", () => {
      const result = body({ streaming: true });
      expect(result.replyText).toBe("");
      expect(result.interrupted).toBe(false);
    });
  });

  describe("pending fences", () => {
    it("shows the placeholder while the block is still streaming", () => {
      expect(body({ pending: true, streaming: true }).showPending).toBe(true);
    });

    // A stream cut off mid-fence leaves `pending` true forever. Left alone
    // that is a "Preparing a change…" line that never resolves.
    it("drops the placeholder once the stream has ended and reports the interruption", () => {
      const result = body({ pending: true, streaming: false });
      expect(result.showPending).toBe(false);
      expect(result.interrupted).toBe(true);
    });
  });

  describe("unrenderable blocks", () => {
    it("never flashes the failure mid-reply", () => {
      expect(body({ unrenderable: true, streaming: true }).showUnrenderable).toBe(false);
    });

    it("shows the failure once the reply has settled, and is not 'interrupted'", () => {
      const result = body({ unrenderable: true });
      expect(result.showUnrenderable).toBe(true);
      expect(result.interrupted).toBe(false);
    });
  });

  describe("interruption", () => {
    it("flags a settled turn that produced nothing at all", () => {
      const result = body();
      expect(result.interrupted).toBe(true);
      expect(VOICE_TURN_INTERRUPTED_TEXT.length).toBeGreaterThan(0);
    });
  });

  // Bad input reaching this function means a settled turn renders blank —
  // exactly the bug — so it degrades instead of throwing.
  describe("graceful handling of bad input", () => {
    const bad: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace only", "   \n  "],
      ["a number", 42],
      ["an object", {}],
    ];

    it.each(bad)("treats %s as absent prose without throwing", (_label, value) => {
      expect(() => body({ cleaned: value as string })).not.toThrow();
      expect(body({ cleaned: value as string, proposalCount: 1 }).replyText).toBe(
        "Here's the change I've prepared.",
      );
    });

    it.each(bad)("treats %s as an absent applied notice without throwing", (_label, value) => {
      const result = body({ appliedNotice: value as string });
      expect(result.replyText).toBe("");
      expect(result.interrupted).toBe(true);
    });

    it.each([
      ["negative", -1],
      ["fractional", 1.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["a string", "2"],
      ["null", null],
    ])("does not invent an introduction from a %s proposal count", (_label, value) => {
      const result = body({ proposalCount: value as number });
      expect(result.replyText === "" || result.replyText.startsWith("Here")).toBe(true);
      expect(() => body({ proposalCount: value as number })).not.toThrow();
    });

    it("trims a fractional count down rather than printing it", () => {
      expect(body({ proposalCount: 2.7 }).replyText).toBe("Here are the 2 changes I've prepared.");
    });

    it("survives a wholly missing input object", () => {
      expect(() => describeVoiceTurnBody(undefined as unknown as VoiceTurnBodyInput)).not.toThrow();
      expect(describeVoiceTurnBody(undefined as unknown as VoiceTurnBodyInput).interrupted).toBe(true);
    });
  });

  // THE INVARIANT. A settled turn that renders no prose, no placeholder, no
  // failure notice and no interruption line is the blank screen the user
  // photographed. Asserted across the whole cross-product rather than at the
  // handful of points above, because the bug was an unreachable-looking
  // combination that turned out to be the common case.
  describe("invariant: a settled turn is never blank", () => {
    const cleanedOptions = ["", "   ", "Added it."];
    const counts = [0, 1, 2];
    const flags = [false, true];
    const notices = [null, "", "Change applied"];

    for (const cleaned of cleanedOptions) {
      for (const proposalCount of counts) {
        for (const pending of flags) {
          for (const unrenderable of flags) {
            for (const streaming of flags) {
              for (const appliedNotice of notices) {
                const input: VoiceTurnBodyInput = {
                  cleaned,
                  proposalCount,
                  pending,
                  unrenderable,
                  streaming,
                  appliedNotice,
                };
                it(`holds for ${JSON.stringify(input)}`, () => {
                  const result = describeVoiceTurnBody(input);
                  const blank =
                    result.replyText.length === 0 &&
                    !result.showPending &&
                    !result.showUnrenderable &&
                    !result.interrupted;
                  // One-directional: a streaming turn MAY be blank (the
                  // reply has not arrived yet). A settled turn may never be.
                  if (!streaming) expect(blank).toBe(false);
                });
              }
            }
          }
        }
      }
    }
  });
});
