// No import of describe/it/expect — Jest globals, same as deep-links.test.ts
// and every other test in this directory.

import {
  appendNoteParagraph,
  decodeNoteEntities,
  escapeNoteHtml,
  htmlToPlainText,
  normalizeContent,
  trimTrailingEmptyParagraph,
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

describe("trimTrailingEmptyParagraph", () => {
  it("drops the empty paragraph a brand-new TipTap document serializes as", () => {
    expect(trimTrailingEmptyParagraph("<p></p>")).toBe("");
  });

  it("drops a trailing empty paragraph after real content", () => {
    expect(trimTrailingEmptyParagraph("<p>a</p><p></p>")).toBe("<p>a</p>");
  });

  it("drops every shape of empty paragraph TipTap emits", () => {
    expect(trimTrailingEmptyParagraph("<p>a</p><p><br></p>")).toBe("<p>a</p>");
    expect(trimTrailingEmptyParagraph("<p>a</p><p><br/></p>")).toBe("<p>a</p>");
    expect(trimTrailingEmptyParagraph("<p>a</p><p>&nbsp;</p>")).toBe("<p>a</p>");
    expect(trimTrailingEmptyParagraph(`<p>a</p><p style="text-align: center"></p>`)).toBe("<p>a</p>");
  });

  it("drops a whole run of trailing empties, not just the last one", () => {
    expect(trimTrailingEmptyParagraph("<p>a</p><p></p>\n<p><br></p>")).toBe("<p>a</p>");
  });

  it("leaves an empty paragraph that is NOT at the end alone", () => {
    // Deliberate spacing in the middle of a document is the user's, not ours
    // to remove — only the trailing one is an artifact of how TipTap pads.
    expect(trimTrailingEmptyParagraph("<p>a</p><p></p><p>b</p>")).toBe("<p>a</p><p></p><p>b</p>");
  });

  it("leaves a document that ends in real content untouched", () => {
    expect(trimTrailingEmptyParagraph("<p>a</p>")).toBe("<p>a</p>");
    expect(trimTrailingEmptyParagraph("")).toBe("");
  });
});

describe("appendNoteParagraph", () => {
  it("appends the spoken content as its own escaped paragraph", () => {
    expect(appendNoteParagraph("<p>Existing</p>", "milk & eggs")).toBe(
      "<p>Existing</p><p>milk &amp; eggs</p>",
    );
  });

  it("does not leave a blank line above the first dictated sentence on a new page", () => {
    // The exact shape `editor.getHTML()` returns for a page created with
    // `content: ""` — the empty TipTap document. Without the trailing-empty
    // trim this produced "<p></p><p>First sentence</p>", i.e. every
    // voice-first page opening with a blank line.
    expect(appendNoteParagraph("<p></p>", "First sentence")).toBe("<p>First sentence</p>");
  });

  it("does not accumulate blank lines between dictated sentences", () => {
    // Mid-dictation shape: TipTap has padded a trailing empty paragraph onto
    // the document since the last phrase landed.
    expect(appendNoteParagraph("<p>First.</p><p><br></p>", "Second.")).toBe(
      "<p>First.</p><p>Second.</p>",
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
