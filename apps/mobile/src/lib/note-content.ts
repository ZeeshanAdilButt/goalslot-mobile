// Shared by every call site that reads or writes a note's HTML body:
// app/(app)/note/[id].tsx's editor and app/(app)/voice.tsx's "add this to my
// X notes" voice command. Pulled out from note/[id].tsx (which used to carry
// `normalizeContent` alone) so the two call sites read an empty note, and
// write a spoken sentence into one, the exact same way rather than through
// two copies that could quietly disagree.
//
// Journal entries store the same TipTap-authored HTML as notes do, so the
// screens that show one as text — app/(app)/journal.tsx's "Recent entries"
// rows and app/(app)/coach.tsx's day analysis — read it through
// `htmlToPlainText` here rather than growing their own strippers.

/** The API defaults new rows to '[]' (legacy JSON-blocks format) — treat
 *  that, and whitespace-only strings, as an empty document rather than
 *  rendering the literal characters. */
export function normalizeContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "" || trimmed === "[]") return "";
  return content;
}

/** Escapes text for safe inclusion inside the note's HTML body. Needed here
 *  specifically because a voice command writes a sentence nobody has
 *  reviewed straight into TipTap's stored HTML — without this, a stray
 *  `<`/`&`/`"` in what was heard would be parsed as markup instead of shown
 *  as the text the speaker actually said. */
export function escapeNoteHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The exact inverse of `escapeNoteHtml`, plus the `&nbsp;` TipTap emits for
 *  runs of spaces. Deliberately one pass over the string rather than a chain
 *  of `.replace` calls: chained decoding is order-dependent and double-decodes
 *  (running `&amp;` first turns a literal `&amp;lt;` into `&lt;` and then into
 *  `<`), whereas a single scan never re-examines what it just wrote. */
export function decodeNoteEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity] ?? entity);
}

/** Flattens a note's or journal entry's stored HTML body down to the one line
 *  of plain text a list row previews, so the Journal screen's "Recent entries"
 *  shows the sentence the user wrote rather than the `<blockquote><p><em>` it
 *  was authored as in the web app's TipTap editor.
 *
 *  NOT a sanitizer, and must never be used as one: the output is display text
 *  bound to a React Native `<Text>` (and to `accessibilityLabel`s), never
 *  re-inserted into markup or a webview, so there is no XSS surface here for
 *  it to defend. Anything writing back into the note's HTML body wants
 *  `escapeNoteHtml` instead.
 *
 *  Tags are stripped before entities are decoded — decoding first would turn
 *  an escaped `&lt;p&gt;` the user actually typed into a `<p>` that the tag
 *  strip then swallowed. Each tag becomes a space rather than nothing, since
 *  losing the boundary between two `<p>`s (`onetwo`) is a guaranteed misread
 *  on every multi-paragraph entry, while the cost — a seam inside a word split
 *  by an inline mark — is rare and merely cosmetic in a one-line preview. */
export function htmlToPlainText(html: string): string {
  // `normalizeContent` first so the legacy '[]' placeholder reads as an empty
  // document here too, instead of previewing as literal brackets.
  return decodeNoteEntities(normalizeContent(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Appends one spoken sentence onto an existing note's HTML body as its own
 *  paragraph. The one write path (app/(app)/voice.tsx's confirmed
 *  APPEND_NOTE command) that adds to a page's content without the user
 *  having opened the rich-text editor at all — escaped and wrapped in `<p>`
 *  rather than spliced into whatever markup already ends the document, so it
 *  always lands as a new, well-formed block instead of merging into
 *  whatever tag the existing content happened to end with. */
export function appendNoteParagraph(existingContent: string, spoken: string): string {
  return `${normalizeContent(existingContent)}<p>${escapeNoteHtml(spoken)}</p>`;
}
