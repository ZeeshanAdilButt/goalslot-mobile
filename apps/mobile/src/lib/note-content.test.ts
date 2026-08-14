// No import of describe/it/expect — Jest globals, same as deep-links.test.ts
// and every other test in this directory.

import {
  appendNoteParagraph,
  decodeNoteEntities,
  escapeNoteHtml,
  htmlToPlainText,
  normalizeContent,
} from "./note-content";

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

describe("htmlToPlainText", () => {
  it("shows the sentence a TipTap document was authored as, not its markup", () => {
    // The exact shape from the bug report: the Journal screen's recent-entry
    // rows were previewing this as literal `<blockquote><p><em>` text.
    expect(
      htmlToPlainText("<blockquote><p><em>A feeling is usually just a fact in disguise.</em></p></blockquote>"),
    ).toBe("A feeling is usually just a fact in disguise.");
  });

  it("strips tags", () => {
    expect(htmlToPlainText("<p>Hello <strong>there</strong></p>")).toBe("Hello there");
  });

  it("keeps adjacent blocks from running together", () => {
    expect(htmlToPlainText("<p>One</p><p>Two</p>")).toBe("One Two");
  });

  it("decodes every entity escapeNoteHtml produces, plus TipTap's &nbsp;", () => {
    expect(htmlToPlainText("<p>&lt;b&gt; &amp; &quot;q&quot; &#39;a&#39;&nbsp;end</p>")).toBe(
      `<b> & "q" 'a' end`,
    );
  });

  it("round-trips text that was escaped on the way in", () => {
    expect(htmlToPlainText(`<p>${escapeNoteHtml(`milk & <eggs>`)}</p>`)).toBe("milk & <eggs>");
  });

  it("collapses whitespace runs, including newlines, into single spaces", () => {
    expect(htmlToPlainText("<p>  spaced   out \n\n  words  </p>")).toBe("spaced out words");
  });

  it("treats the legacy '[]' placeholder as an empty document", () => {
    expect(htmlToPlainText("[]")).toBe("");
  });

  it("returns empty for an empty string", () => {
    expect(htmlToPlainText("")).toBe("");
  });

  it("returns empty for a structurally non-empty but wordless document", () => {
    // The case that made `hasContent` wrong when it was measured on the raw
    // HTML: seven characters long, zero words, must read as "No content".
    expect(htmlToPlainText("<p></p>")).toBe("");
    expect(htmlToPlainText("<blockquote><p><br></p></blockquote>")).toBe("");
    expect(htmlToPlainText("<p>&nbsp;</p>")).toBe("");
  });
});

describe("decodeNoteEntities", () => {
  it("never double-decodes an escaped entity", () => {
    // `&amp;lt;` is how a user's literal "&lt;" is stored. Decoding in
    // sequential passes would resolve it to "<" and lose what they typed.
    expect(decodeNoteEntities("&amp;lt;")).toBe("&lt;");
    expect(htmlToPlainText("<p>&amp;lt;</p>")).toBe("&lt;");
  });

  it("leaves entities it does not own untouched", () => {
    expect(decodeNoteEntities("&copy; &#8217;")).toBe("&copy; &#8217;");
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
