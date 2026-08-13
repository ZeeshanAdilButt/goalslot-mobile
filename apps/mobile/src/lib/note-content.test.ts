// No import of describe/it/expect — Jest globals, same as deep-links.test.ts
// and every other test in this directory.

import { appendNoteParagraph, escapeNoteHtml, normalizeContent } from "./note-content";

describe("normalizeContent", () => {
  it("treats the API's default new-row value as an empty document", () => {
    expect(normalizeContent("[]")).toBe("");
  });

  it("treats whitespace-only content as empty", () => {
    expect(normalizeContent("   ")).toBe("");
  });

  it("leaves real HTML content untouched", () => {
    expect(normalizeContent("<p>Hello</p>")).toBe("<p>Hello</p>");
  });
});

describe("escapeNoteHtml", () => {
  it("escapes every character that could otherwise be read as markup", () => {
    expect(escapeNoteHtml(`<script>alert("hi")</script> & 'quote'`)).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; &amp; &#39;quote&#39;",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeNoteHtml("call mom back")).toBe("call mom back");
  });
});

describe("appendNoteParagraph", () => {
  it("appends the spoken content as its own escaped paragraph", () => {
    expect(appendNoteParagraph("<p>Existing</p>", "milk & eggs")).toBe(
      "<p>Existing</p><p>milk &amp; eggs</p>",
    );
  });

  it("starts from an empty document when the note was blank ('[]')", () => {
    expect(appendNoteParagraph("[]", "milk")).toBe("<p>milk</p>");
  });

  it("never lets spoken markup break out of its own paragraph", () => {
    // Free text nobody has reviewed, written straight from a microphone —
    // this is the one write path where that matters most.
    const result = appendNoteParagraph("<p>Existing</p>", "<b>urgent</b> call back");
    expect(result).toBe("<p>Existing</p><p>&lt;b&gt;urgent&lt;/b&gt; call back</p>");
    expect(result).not.toContain("<b>urgent</b>");
  });
});
