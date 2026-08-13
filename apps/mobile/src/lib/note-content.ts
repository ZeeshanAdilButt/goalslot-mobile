// Shared by every call site that reads or writes a note's HTML body:
// app/(app)/note/[id].tsx's editor and app/(app)/voice.tsx's "add this to my
// X notes" voice command. Pulled out from note/[id].tsx (which used to carry
// `normalizeContent` alone) so the two call sites read an empty note, and
// write a spoken sentence into one, the exact same way rather than through
// two copies that could quietly disagree.

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
