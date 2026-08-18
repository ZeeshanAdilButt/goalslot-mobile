// No import of describe/it/expect — Jest globals, same as recent-entries.test.ts
// and every other test in this directory.

import {
  appendUntanglePrompt,
  DAILY_PLACEHOLDER_PROMPTS,
  formatUntanglePromptForInsert,
  JOURNAL_AFFIRMATIONS,
  promptForDate,
  UNTANGLE_PROMPTS,
  type UntanglePrompt,
} from "./journal-writing-help";

describe("UNTANGLE_PROMPTS", () => {
  it("has all 10 prompts, each with a unique id, a title, and a body", () => {
    expect(UNTANGLE_PROMPTS).toHaveLength(10);
    const ids = new Set(UNTANGLE_PROMPTS.map((p) => p.id));
    expect(ids.size).toBe(10);
    for (const prompt of UNTANGLE_PROMPTS) {
      expect(prompt.title.length).toBeGreaterThan(0);
      expect(prompt.body.length).toBeGreaterThan(0);
    }
  });
});

describe("promptForDate", () => {
  it("is deterministic — the same date always returns the same prompt", () => {
    const a = promptForDate("2026-08-18");
    const b = promptForDate("2026-08-18");
    expect(a).toBe(b);
    expect(DAILY_PLACEHOLDER_PROMPTS).toContain(a);
  });

  it("matches web's exact hash for known dates (journal-entry-editor.tsx's promptForDate, same PROMPTS order)", () => {
    // hash = 0; for each char: hash = (hash*31 + charCode) >>> 0; index = hash % 5.
    // Hand-verified against the ported algorithm for a fixed set of dates so
    // a future edit to either the hash or the prompt list/order trips this.
    expect(promptForDate("2026-08-18")).toBe(DAILY_PLACEHOLDER_PROMPTS[0]);
    expect(promptForDate("2026-01-01")).toBe(DAILY_PLACEHOLDER_PROMPTS[0]);
    expect(promptForDate("2025-12-31")).toBe(DAILY_PLACEHOLDER_PROMPTS[4]);
  });

  it("different dates can select different prompts (the hash isn't a constant)", () => {
    const results = new Set(
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"].map(promptForDate),
    );
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("formatUntanglePromptForInsert", () => {
  it("puts the title on its own line above the body", () => {
    const prompt: UntanglePrompt = { id: "x", title: "Title here", body: "Body here." };
    expect(formatUntanglePromptForInsert(prompt)).toBe("Title here\nBody here.");
  });
});

describe("appendUntanglePrompt", () => {
  const prompt: UntanglePrompt = { id: "x", title: "Title", body: "Body." };

  it("becomes the whole draft when the existing draft is empty", () => {
    expect(appendUntanglePrompt("", prompt)).toBe("Title\nBody.");
  });

  it("becomes the whole draft when the existing draft is whitespace-only", () => {
    expect(appendUntanglePrompt("   \n  ", prompt)).toBe("Title\nBody.");
  });

  it("adds a blank-line separator after non-empty text with no trailing newline", () => {
    expect(appendUntanglePrompt("Earlier thoughts.", prompt)).toBe("Earlier thoughts.\n\nTitle\nBody.");
  });

  it("adds one more newline (not a doubled gap) when the draft already ends in a single newline", () => {
    expect(appendUntanglePrompt("Earlier thoughts.\n", prompt)).toBe("Earlier thoughts.\n\nTitle\nBody.");
  });

  it("adds no extra separator when the draft already ends in a blank line", () => {
    expect(appendUntanglePrompt("Earlier thoughts.\n\n", prompt)).toBe("Earlier thoughts.\n\nTitle\nBody.");
  });
});

describe("JOURNAL_AFFIRMATIONS", () => {
  it("has all 6 phrases, ported verbatim and in web's order", () => {
    expect(JOURNAL_AFFIRMATIONS).toEqual([
      "Relax and write.",
      "Untangle a thought.",
      "Nothing leaves here.",
      "A sentence is enough.",
      "Today doesn't have to be tidy.",
      "Write the noisy version first.",
    ]);
  });
});
