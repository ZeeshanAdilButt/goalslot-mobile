import {
  countJournalWords,
  describeJournalDelete,
  describeRecentEntry,
  hasJournalContent,
  journalEntryPreview,
  removeJournalEntry,
} from "./recent-entries";

import type { JournalEntry } from "@goalslot/shared";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return { id: "je_1", date: "2026-08-14", content: "", ...overrides };
}

// A locale-independent stand-in for whatever `formatDisplayDate` produces —
// the helpers take the label as an argument precisely so these tests don't
// depend on the runner's locale.
const LABEL = "Friday, August 14, 2026";

describe("journalEntryPreview", () => {
  it("flattens the TipTap HTML entries are stored as", () => {
    // Rendering `content` raw put the literal tags on screen and into what a
    // screen reader spoke — the bug this indirection exists to prevent.
    expect(journalEntryPreview("<p>Shipped the <em>fix</em>.</p>")).toBe("Shipped the fix .");
  });

  it("treats a structurally non-empty but wordless document as empty", () => {
    // `'<p></p>'.length` is 7, so any length check on the raw HTML calls this
    // "has content" and renders a blank-looking row instead of the
    // "No content" placeholder.
    expect(journalEntryPreview("<p></p>")).toBe("");
    expect(hasJournalContent("<p></p>")).toBe(false);
    expect(hasJournalContent("<p>anything</p>")).toBe(true);
  });
});

describe("countJournalWords", () => {
  it("counts words, not characters, and treats blank text as zero", () => {
    expect(countJournalWords("")).toBe(0);
    expect(countJournalWords("   \n  ")).toBe(0);
    expect(countJournalWords("one")).toBe(1);
    expect(countJournalWords("  a long  day   today ")).toBe(4);
  });
});

describe("describeRecentEntry", () => {
  it("leads with the date and follows with what was written", () => {
    expect(describeRecentEntry(entry({ content: "<p>Ran 5k</p>" }), LABEL)).toBe(`${LABEL}, Ran 5k`);
  });

  it("says 'no content' out loud rather than trailing off", () => {
    // The visible row shows an italic "No content" placeholder; a screen
    // reader user needs the same cue to know which days are worth opening.
    expect(describeRecentEntry(entry({ content: "" }), LABEL)).toBe(`${LABEL}, no content`);
  });

  it("truncates a long entry instead of reciting the whole day", () => {
    const label = describeRecentEntry(entry({ content: "word ".repeat(200) }), LABEL);
    expect(label.length).toBeLessThanOrEqual(LABEL.length + 2 + 80);
  });
});

describe("describeJournalDelete", () => {
  it("quantifies the writing that disappears, and names the day", () => {
    // "this item" would be useless here: the thing that can't be recovered is
    // prose, and the rows carry no day headers to identify which one is going.
    const { title, description } = describeJournalDelete(entry({ content: "<p>a b c</p>" }), LABEL);

    expect(title).toBe("Delete this entry?");
    expect(description).toContain("3 words");
    expect(description).toContain(LABEL);
    expect(description).toContain("can't be undone");
  });

  it("singularises a one-word entry", () => {
    expect(describeJournalDelete(entry({ content: "hi" }), LABEL).description).toContain("1 word ");
  });

  it("drops the irreversibility warning for an empty day", () => {
    // Deleting an empty entry destroys nothing — warning about it would be
    // theatre, and it would train people to ignore the real warning.
    const { description } = describeJournalDelete(entry({ content: "<p></p>" }), LABEL);

    expect(description).toContain("empty");
    expect(description).not.toContain("can't be undone");
  });

  it("counts words from the flattened text, not the markup", () => {
    // Counting the raw HTML would bill `<p>` and `</p>` as words and quote a
    // number the editor's own live counter disagrees with.
    expect(describeJournalDelete(entry({ content: "<p>one two</p>" }), LABEL).description).toContain("2 words");
  });
});

describe("removeJournalEntry", () => {
  it("removes by date, which is what the DELETE endpoint is keyed on", () => {
    const entries = [entry({ date: "2026-08-14" }), entry({ date: "2026-08-13", id: "je_2" })];

    expect(removeJournalEntry(entries, "2026-08-14").map((e) => e.date)).toEqual(["2026-08-13"]);
  });

  it("leaves the list alone when that day isn't in it", () => {
    const entries = [entry({ date: "2026-08-13" })];

    expect(removeJournalEntry(entries, "2026-08-14")).toEqual(entries);
  });

  it("ignores ids entirely, including a local one from an unsynced save", () => {
    // A day saved offline carries a client-generated id that the server has
    // never seen. Filtering on id would fail to remove exactly the rows most
    // likely to be deleted right after being written.
    const entries = [entry({ date: "2026-08-14", id: "local_abc", pendingSync: true })];

    expect(removeJournalEntry(entries, "2026-08-14")).toEqual([]);
  });
});
