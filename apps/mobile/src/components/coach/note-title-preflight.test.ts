import { describeNoteTitlePreflight } from "./note-title-preflight";

// The user's real page tree, from the screenshots that produced this bug.
const REAL_PAGES = [
  "Todo",
  "Tech to learn",
  "12 Week Infrastructure Plan",
  "Some thing",
  "20 articles and books",
  "Olostep",
  "AWS",
  "Steno Health",
  "ALY",
  "Zobi",
];

describe("describeNoteTitlePreflight", () => {
  it("names the page that does not exist, and points at the real one", () => {
    // THE reported case: the Coach said it would append to "your learning
    // notes"; the user has "Tech to learn" and no page by that name.
    const result = describeNoteTitlePreflight("learning notes", REAL_PAGES);
    expect(result?.kind).toBe("no-match");
    expect(result?.message).toContain('No page called "learning notes"');
    expect(result?.message).toContain('"Tech to learn"');
  });

  it("says nothing when the hint is the page's exact title", () => {
    expect(describeNoteTitlePreflight("Tech to learn", REAL_PAGES)).toBeNull();
  });

  it("says nothing when the hint differs only by case and whitespace", () => {
    expect(describeNoteTitlePreflight("  tech   to LEARN ", REAL_PAGES)).toBeNull();
  });

  it("says nothing when exactly one page matches by substring, as the server would resolve it", () => {
    // "Steno" is contained in "Steno Health" and nothing else — the server's
    // second tier resolves this, so a warning here would be noise on a row
    // that is going to succeed.
    expect(describeNoteTitlePreflight("Steno", REAL_PAGES)).toBeNull();
  });

  it("says nothing when the page's title is contained in a wordier hint", () => {
    expect(describeNoteTitlePreflight("my AWS page", REAL_PAGES)).toBeNull();
  });

  it("lists the pages that matched when the hint is ambiguous", () => {
    const result = describeNoteTitlePreflight("a", ["Alpha", "Beta a", "Gamma"]);
    expect(result?.kind).toBe("ambiguous");
    expect(result?.message).toContain('"Alpha"');
    expect(result?.message).toContain('"Beta a"');
  });

  it("reports duplicate exact titles rather than pretending one will be picked", () => {
    const result = describeNoteTitlePreflight("Ideas", ["Ideas", "ideas", "Other"]);
    expect(result?.kind).toBe("ambiguous");
    expect(result?.message).toContain("2 pages");
  });

  it("still names the missing page when nothing is even close", () => {
    const result = describeNoteTitlePreflight("quarterly board minutes", ["AWS", "Zobi"]);
    expect(result?.kind).toBe("no-match");
    expect(result?.message).toContain('No page called "quarterly board minutes"');
    expect(result?.message).toContain("Create it first");
  });

  // The guard that keeps this from becoming its own bug: a warning derived
  // from an unfetched list is a warning derived from ignorance, and it would
  // fire on EVERY note card on a cold start.
  it("stays silent when the notes list has not been fetched", () => {
    expect(describeNoteTitlePreflight("anything", [])).toBeNull();
  });

  it("stays silent when the model sent no titleHint at all", () => {
    expect(describeNoteTitlePreflight(null, REAL_PAGES)).toBeNull();
    expect(describeNoteTitlePreflight(undefined, REAL_PAGES)).toBeNull();
    expect(describeNoteTitlePreflight("   ", REAL_PAGES)).toBeNull();
  });

  it("ignores blank-titled pages instead of matching them against everything", () => {
    // An empty normalized title is a substring of every hint; without the
    // server's own guard it would silently match anything.
    expect(describeNoteTitlePreflight("whatever", ["", "   ", "AWS"])?.kind).toBe("no-match");
  });

  // Every message must name what was searched for. This is the user's
  // explicit ask — "if it heard wrong it gives error instead of saying no
  // notes exists" — expressed as an assertion so it cannot regress.
  it.each([
    ["learning notes", REAL_PAGES],
    ["quarterly board minutes", ["AWS", "Zobi"]],
    ["a", ["Alpha", "Beta a", "Gamma"]],
  ] as const)("always quotes the hint it searched for (%s)", (hint, titles) => {
    const result = describeNoteTitlePreflight(hint, titles);
    expect(result).not.toBeNull();
    expect(result?.message).toContain(`"${hint}"`);
    expect(result?.message.toLowerCase()).not.toContain("something went wrong");
  });
});
