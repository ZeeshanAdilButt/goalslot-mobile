// Cover for the Coach reply markdown grammar — same convention as
// category-search.test.ts: the pure module is tested directly, the component
// that renders its output isn't mounted.
//
// The case this file exists for is `renders "### What Worked:" as a heading`
// below: that exact string shipped to a user's Android phone and appeared on
// screen with its hashes intact.

import { isSafeHref, parseBlocks, parseInline, toPlainText, type Block } from "./markdown-lite";

/** The single block a one-line input parses to — most cases only care about that. */
function block(line: string): Block {
  const blocks = parseBlocks(line);
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

function text(value: string) {
  return { type: "text", text: value };
}

describe("parseBlocks — headings", () => {
  it('renders "### What Worked:" as a heading, not literal text', () => {
    expect(block("### What Worked:")).toEqual({
      type: "heading",
      level: 3,
      spans: [text("What Worked:")],
    });
  });

  it("renders the sibling heading from the same reply", () => {
    expect(block("### What Did Not Work:")).toEqual({
      type: "heading",
      level: 3,
      spans: [text("What Did Not Work:")],
    });
  });

  it("reads the heading level from the number of hashes", () => {
    expect(block("# H1")).toMatchObject({ type: "heading", level: 1 });
    expect(block("## H2")).toMatchObject({ type: "heading", level: 2 });
    expect(block("###### H6")).toMatchObject({ type: "heading", level: 6 });
  });

  it("does not treat more than six hashes as a heading", () => {
    expect(block("####### too deep")).toMatchObject({ type: "para" });
  });

  it("requires a space after the hashes, so a hashtag stays text", () => {
    expect(block("#NoSpace")).toEqual({ type: "para", spans: [text("#NoSpace")] });
  });

  it("keeps a bare '#' or '##' as plain text while a reply is still streaming", () => {
    // A heading must never flash at the wrong tier as tokens arrive: the
    // required trailing space means `#` -> `##` -> `### Foo` renders as text
    // until the whole marker has landed.
    expect(block("#")).toMatchObject({ type: "para" });
    expect(block("##")).toMatchObject({ type: "para" });
  });

  it("drops CommonMark's optional closing hashes", () => {
    expect(block("## Recap ##")).toEqual({ type: "heading", level: 2, spans: [text("Recap")] });
  });

  it("formats inline spans inside a heading", () => {
    expect(block("### **Focus** time")).toEqual({
      type: "heading",
      level: 3,
      spans: [{ type: "bold", text: "Focus" }, text(" time")],
    });
  });

  it("tolerates up to three spaces of indent", () => {
    expect(block("   ### Indented")).toMatchObject({ type: "heading", level: 3 });
  });
});

describe("parseBlocks — lists", () => {
  it("reads both bullet markers", () => {
    expect(block("- item")).toEqual({ type: "bullet", depth: 0, spans: [text("item")] });
    expect(block("*   item")).toEqual({ type: "bullet", depth: 0, spans: [text("item")] });
  });

  it("indents a nested bullet instead of printing it raw", () => {
    expect(block("    - nested")).toEqual({ type: "bullet", depth: 2, spans: [text("nested")] });
    expect(block("  - one level")).toEqual({ type: "bullet", depth: 1, spans: [text("one level")] });
  });

  it("clamps very deep indentation to the deepest visual level", () => {
    expect(block("            - very deep")).toMatchObject({ type: "bullet", depth: 2 });
  });

  it("reads ordered items written with either '.' or ')'", () => {
    expect(block("1. first")).toEqual({
      type: "ordered",
      marker: "1",
      depth: 0,
      spans: [text("first")],
    });
    expect(block("2) second")).toEqual({
      type: "ordered",
      marker: "2",
      depth: 0,
      spans: [text("second")],
    });
  });

  it("does not read a year or a bare dash as a list marker", () => {
    expect(block("2026. was the year")).toMatchObject({ type: "para" });
    expect(block("-> next")).toMatchObject({ type: "para" });
  });
});

describe("parseBlocks — quotes, rules and gaps", () => {
  it("reads a blockquote", () => {
    expect(block("> quoted")).toEqual({ type: "quote", spans: [text("quoted")] });
  });

  it("reads a thematic break, including the spaced form", () => {
    // `- - -` also matches the bullet pattern; the rule must win or it
    // renders as a stray "• - -" list row.
    expect(block("---")).toEqual({ type: "rule" });
    expect(block("- - -")).toEqual({ type: "rule" });
    expect(block("***")).toEqual({ type: "rule" });
    expect(block("___")).toEqual({ type: "rule" });
  });

  it("does not mistake bold at the start of a line for a thematic break", () => {
    expect(block("**bold**")).toMatchObject({ type: "para" });
  });

  it("treats a blank or whitespace-only line as a paragraph gap", () => {
    expect(parseBlocks("a\n\nb")).toEqual([
      { type: "para", spans: [text("a")] },
      { type: "gap" },
      { type: "para", spans: [text("b")] },
    ]);
    expect(block("   ")).toEqual({ type: "gap" });
  });

  it("splits on CRLF as well as LF", () => {
    expect(parseBlocks("### A\r\n- b")).toEqual([
      { type: "heading", level: 3, spans: [text("A")] },
      { type: "bullet", depth: 0, spans: [text("b")] },
    ]);
  });
});

describe("parseInline", () => {
  it("reads a bold span", () => {
    expect(parseInline("**bold** ok")).toEqual([{ type: "bold", text: "bold" }, text(" ok")]);
  });

  it("reads bold whose contents contain a single asterisk", () => {
    // The predecessor matched bold with `[^*]+`, so any inner `*` made the
    // whole thing render as raw characters.
    expect(parseInline("**a*b** mixed")).toEqual([
      { type: "bold", text: "a*b" },
      text(" mixed"),
    ]);
  });

  it("reads italics with either marker", () => {
    expect(parseInline("*em*")).toEqual([{ type: "italic", text: "em" }]);
    expect(parseInline("_em_")).toEqual([{ type: "italic", text: "em" }]);
  });

  it("leaves snake_case identifiers alone", () => {
    expect(parseInline("snake_case_name")).toEqual([text("snake_case_name")]);
  });

  it("leaves spaced asterisks (multiplication) alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
  });

  it("reads inline code, and does not re-format its contents", () => {
    expect(parseInline("run `npm **test**` now")).toEqual([
      text("run "),
      { type: "code", text: "npm **test**" },
      text(" now"),
    ]);
  });

  it("reads a link", () => {
    expect(parseInline("see [docs](https://example.com/a) here")).toEqual([
      text("see "),
      { type: "link", text: "docs", href: "https://example.com/a" },
      text(" here"),
    ]);
  });

  it("keeps every construct in order in one pass", () => {
    expect(parseInline("**b** and *i* and `c` and [l](https://x.dev)")).toEqual([
      { type: "bold", text: "b" },
      text(" and "),
      { type: "italic", text: "i" },
      text(" and "),
      { type: "code", text: "c" },
      text(" and "),
      { type: "link", text: "l", href: "https://x.dev" },
    ]);
  });

  it("leaves an unterminated delimiter as literal text (streaming guard)", () => {
    expect(parseInline("**bo")).toEqual([text("**bo")]);
    expect(parseInline("[label](")).toEqual([text("[label](")]);
    expect(parseInline("`code")).toEqual([text("`code")]);
    expect(parseInline("some *ital")).toEqual([text("some *ital")]);
  });
});

describe("isSafeHref", () => {
  it("allows the schemes a Coach reply legitimately links to", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.com")).toBe(true);
    expect(isSafeHref("tel:+15550100")).toBe(true);
  });

  it("rejects app deep links and script targets from model output", () => {
    expect(isSafeHref("goalslot://settings")).toBe(false);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("/relative/path")).toBe(false);
  });
});

describe("toPlainText", () => {
  it("strips markers so a screen reader doesn't announce them", () => {
    expect(toPlainText("### What Worked:\n- **a** b")).toBe("What Worked:\na b");
  });

  it("keeps a link's label rather than its target", () => {
    expect(toPlainText("see [docs](https://example.com)")).toBe("see docs");
  });

  it("keeps paragraph breaks but collapses runs of them", () => {
    expect(toPlainText("one\n\n\n\ntwo")).toBe("one\n\ntwo");
  });

  it("drops a thematic break entirely", () => {
    expect(toPlainText("one\n---\ntwo")).toBe("one\n\ntwo");
  });
});
