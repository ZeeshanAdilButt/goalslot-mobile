// No import of describe/it/expect — Jest globals, same as deep-links.test.ts
// and every other test in this directory.

import {
  appendNoteParagraph,
  decodeNoteEntities,
  escapeNoteHtml,
  hasUnsupportedMobileMarkup,
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

describe("hasUnsupportedMobileMarkup", () => {
  // The bug this guards: a note authored in the web editor and then opened on
  // the phone was being silently destroyed. The mobile editor is a webview
  // whose TipTap schema is fixed at package build time and is a strict subset
  // of web's; ProseMirror drops content it has no schema entry for, and this
  // screen's autosave then writes the stripped document back to the server.
  // One tap into the body was enough. Every fixture below is real HTML the web
  // editor emits, and every expectation is what a schema reconstruction of the
  // shipped @10play/tentap-editor bundle actually did to it.

  describe("markup the mobile schema has no node for", () => {
    it("locks a table, which mobile flattens into loose paragraphs", () => {
      // -> <p>Day</p><p>Task</p><p>Mon</p><p>Ship</p>: every cell boundary,
      // every row and the header all gone, unrecoverably.
      expect(
        hasUnsupportedMobileMarkup(
          '<table class="editor-table"><tbody><tr><th><p>Day</p></th><th><p>Task</p></th></tr>' +
            "<tr><td><p>Mon</p></td><td><p>Ship</p></td></tr></tbody></table>",
        ),
      ).toBe(true);
    });

    it("locks a horizontal rule, which mobile deletes outright", () => {
      expect(hasUnsupportedMobileMarkup("<p>above</p><hr><p>below</p>")).toBe(true);
      expect(hasUnsupportedMobileMarkup("<p>above</p><hr /><p>below</p>")).toBe(true);
    });

    it("locks a code block, which mobile collapses to an inline code span", () => {
      // -> <p><code>const a = 1;<br>const b = 2;</code></p>. The block, and the
      // language the syntax highlighting keys off, are both lost.
      expect(
        hasUnsupportedMobileMarkup(
          '<pre class="code-block"><code class="language-javascript">const a = 1;</code></pre>',
        ),
      ).toBe(true);
    });

    it("locks a paragraph with an alignment, which mobile drops", () => {
      expect(hasUnsupportedMobileMarkup('<p style="text-align: center">centered</p>')).toBe(true);
      expect(hasUnsupportedMobileMarkup('<h2 style="text-align: right">right</h2>')).toBe(true);
    });

    it("locks an indented block, which mobile flattens", () => {
      expect(hasUnsupportedMobileMarkup('<p data-indent="2">indented</p>')).toBe(true);
    });

    it("locks a page as soon as ONE unsupported block appears anywhere in it", () => {
      // The realistic shape: a long, mostly-plain page with a single table
      // buried in the middle. Position must not matter.
      expect(
        hasUnsupportedMobileMarkup(
          "<h1>Plan</h1><p>Lots of ordinary prose.</p>".repeat(20) +
            "<table><tbody><tr><td><p>x</p></td></tr></tbody></table>" +
            "<p>More ordinary prose.</p>".repeat(20),
        ),
      ).toBe(true);
    });
  });

  describe("markup that survives the round-trip untouched", () => {
    // These are the false positives that matter. Locking one of these would
    // make a perfectly editable page read-only on the phone for no reason —
    // and since the web editor wraps EVERY block, over-matching here would
    // lock essentially the entire notebook.

    it("does not lock web's div.gs-block wrappers", () => {
      // Mobile strips the wrapper, but web's parseHTML has a bare-`<p>` rule
      // that re-absorbs it, so this is churn in the stored shape, not loss.
      expect(
        hasUnsupportedMobileMarkup(
          '<div class="gs-block gs-block-h1"><h1>Weekly Plan</h1></div>' +
            '<div class="gs-block gs-block-p"><p>Intro paragraph.</p></div>',
        ),
      ).toBe(false);
    });

    it("does not lock a resized image", () => {
      // Deliberate, and the one place both investigations of this bug were
      // wrong: the shipped bundle's image node declares `width` and `height`
      // in addAttributes, exactly as web's ResizableImage does, so the size
      // round-trips. Verified against the minified bundle, not assumed.
      expect(
        hasUnsupportedMobileMarkup('<img src="data:image/png;base64,iVBORw0KGgo=" width="320" height="200">'),
      ).toBe(false);
    });

    it("does not lock a coloured highlight", () => {
      // The bundle configures Highlight with multicolor: true.
      expect(
        hasUnsupportedMobileMarkup(
          '<p><mark data-color="#ffcc00" style="background-color: #ffcc00">hl</mark></p>',
        ),
      ).toBe(false);
    });

    it("does not lock task lists, including checked state", () => {
      expect(
        hasUnsupportedMobileMarkup(
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>',
        ),
      ).toBe(false);
    });

    it("does not lock headings, inline marks, links or blockquotes", () => {
      expect(
        hasUnsupportedMobileMarkup(
          "<h1>Title</h1><h3>Sub</h3><p><strong>b</strong><em>i</em><s>s</s><u>u</u><code>c</code></p>" +
            '<p><a href="https://example.com" class="editor-link">link</a></p>' +
            "<blockquote><p>quote</p></blockquote><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>",
        ),
      ).toBe(false);
    });

    it("does not lock a style attribute that merely contains no alignment", () => {
      expect(hasUnsupportedMobileMarkup('<p style="color: red">red</p>')).toBe(false);
    });

    it("does not lock a page that only mentions the words in its prose", () => {
      // The regexes match tags, not text — a note ABOUT tables is still just
      // paragraphs, and must stay editable on the phone.
      expect(
        hasUnsupportedMobileMarkup("<p>Remember to add a table and a divider to this on the laptop.</p>"),
      ).toBe(false);
    });
  });

  describe("empty documents", () => {
    it("never locks an empty page", () => {
      expect(hasUnsupportedMobileMarkup("")).toBe(false);
      expect(hasUnsupportedMobileMarkup("   ")).toBe(false);
      // The API's default for a brand-new row.
      expect(hasUnsupportedMobileMarkup("[]")).toBe(false);
      expect(hasUnsupportedMobileMarkup("<p></p>")).toBe(false);
    });
  });
});
