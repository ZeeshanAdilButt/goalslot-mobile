// The markdown parser behind `FormattedText` — pure functions over strings,
// no React and no react-native imports, so the whole grammar can be unit
// tested without mounting a component tree (the convention every other
// testable UI rule in this folder follows: see `category-search.ts` /
// `category-search.test.ts`).
//
// WHY THIS EXISTS AT ALL: the Coach's replies are markdown, and the mobile
// client used to render only `**bold**` and `- ` bullets, dumping every
// other construct on screen as raw characters. That shipped a visible bug —
// a reply whose `### What Worked:` / `### What Did Not Work:` headings
// appeared verbatim, hashes and all, on the Coach screen.
//
// WHY NOT A LIBRARY: `goal-slot-web` renders the same Coach text with
// `react-markdown` + `remark-gfm` (see
// goal-slot-web/src/features/coach/components/coach-markdown.tsx), but
// `react-markdown` emits DOM elements and cannot run in React Native at all.
// The React Native markdown packages are unmaintained against this app's
// RN/React/Expo versions. So mobile deliberately mirrors web's *feature set*
// with a small hand-rolled parser instead of taking a dependency.
//
// PARITY WITH WEB, stated explicitly so the divergence is a decision and not
// a surprise: headings, bold, italic, inline code, links, bullet lists,
// ordered lists, blockquotes and thematic breaks are all supported here and
// on web. GFM tables, ~~strikethrough~~ and fenced code blocks render on web
// (via remark-gfm) and are NOT handled here — they fall through as plain
// text. The Coach does not emit them in chat mode; revisit if it starts to.
//
// STREAMING: every rule is line-local and every delimiter must be closed on
// the same line. A half-arrived `**bo` or `[label](` renders as literal text
// and then becomes formatted once the rest of the token arrives, so a
// streaming reply degrades gracefully instead of flickering between shapes.

/** One formatted run inside a single line. */
export type InlineSpan =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

/** One rendered line/element. `gap` is a blank line, `rule` a thematic break. */
export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; spans: InlineSpan[] }
  | { type: "bullet"; depth: number; spans: InlineSpan[] }
  | { type: "ordered"; marker: string; depth: number; spans: InlineSpan[] }
  | { type: "quote"; spans: InlineSpan[] }
  | { type: "rule" }
  | { type: "gap" }
  | { type: "para"; spans: InlineSpan[] };

// A thematic break: three or more of the same marker, optionally spaced
// (`---`, `***`, `___`, `- - -`). This MUST be tested before the bullet rule
// — `- - -` also matches the bullet pattern, and a horizontal rule read as a
// bullet would render a stray "• - -" row.
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// `#{1,6}` followed by REQUIRED whitespace, per CommonMark (`#NoSpace` is not
// a heading). The required space is also what keeps streaming stable: a lone
// `#` renders as text until its space arrives, so a heading never flashes at
// the wrong tier while tokens stream in.
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
// Optional closing hashes, e.g. `### Foo ###` — CommonMark drops them.
const HEADING_TRAILING_HASHES_RE = /[ \t]+#+[ \t]*$/;
// Indent is unbounded (not the old `\s{0,3}` cap) so a nested `    - item`
// renders as an indented bullet instead of raw text.
const BULLET_RE = /^([ \t]*)[*-][ \t]+(.*)$/;
const ORDERED_RE = /^([ \t]*)(\d{1,2})[.)][ \t]+(.*)$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;

const LINK_RE = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;

/** Max visual nesting level; deeper indents all render at the same inset. */
const MAX_DEPTH = 2;

/** Indent width in columns, counting a tab as two spaces. */
function indentWidth(indent: string): number {
  let width = 0;
  for (const char of indent) width += char === "\t" ? 2 : 1;
  return width;
}

/** Two columns of indent per nesting level, clamped so deep lists stay readable. */
function indentDepth(indent: string): number {
  return Math.min(MAX_DEPTH, Math.floor(indentWidth(indent) / 2));
}

/**
 * Emphasis delimiters may not hug whitespace on the inside (`* 3 *` in
 * "2 * 3 * 4" is multiplication, not italics) and may not be empty.
 */
function isEmphasisBody(body: string): boolean {
  return body.length > 0 && !/^\s/.test(body) && !/\s$/.test(body);
}

/** `_` is intraword-safe: `snake_case_name` must not turn into italics. */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\w]/.test(char);
}

/**
 * Splits one line into formatted runs in a SINGLE left-to-right pass.
 *
 * Deliberately not a chain of `String.split()` calls (which is what the
 * bold-only predecessor did): with more than one inline rule, chained splits
 * lose the relative ordering of the constructs and cannot express one rule
 * winning over another at the same position. Precedence at each character is
 * code → link → bold → italic, matching CommonMark's "code spans bind
 * tightest" and making `**a*b**` a single bold run rather than a mangled mix.
 */
export function parseInline(line: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.length > 0) {
      spans.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < line.length) {
    const char = line[i];

    // `code` — binds tightest, so its contents are never re-scanned.
    if (char === "`") {
      const end = line.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        spans.push({ type: "code", text: line.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // `[label](href)`
    if (char === "[") {
      const match = LINK_RE.exec(line.slice(i));
      if (match) {
        flush();
        spans.push({ type: "link", text: match[1], href: match[2] });
        i += match[0].length;
        continue;
      }
    }

    // `**bold**` — matched before single-`*` italics so the opening `**`
    // isn't mistaken for an italic delimiter. Closing on `**` (rather than
    // the old `[^*]+` character class) is what makes `**a*b**` work.
    if (char === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end > i + 2) {
        const body = line.slice(i + 2, end);
        if (isEmphasisBody(body)) {
          flush();
          spans.push({ type: "bold", text: body });
          i = end + 2;
          continue;
        }
      }
    }

    // `*italic*` / `_italic_`
    if (char === "*" || char === "_") {
      const intraword = char === "_" && isWordChar(line[i - 1]);
      if (!intraword) {
        const end = line.indexOf(char, i + 1);
        if (end > i + 1) {
          const body = line.slice(i + 1, end);
          const closesIntraword = char === "_" && isWordChar(line[end + 1]);
          if (isEmphasisBody(body) && !body.includes(char) && !closesIntraword) {
            flush();
            spans.push({ type: "italic", text: body });
            i = end + 1;
            continue;
          }
        }
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return spans;
}

/** Splits a Coach reply into renderable blocks. Rule order below is load-bearing. */
export function parseBlocks(text: string): Block[] {
  return text.split(/\r?\n/).map<Block>((line) => {
    // 1. Thematic break — before the bullet rule, see RULE_RE's comment.
    if (RULE_RE.test(line)) return { type: "rule" };

    // 2. Heading.
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const body = heading[2].replace(HEADING_TRAILING_HASHES_RE, "");
      return { type: "heading", level, spans: parseInline(body) };
    }

    // 3. Bullet list item.
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      return { type: "bullet", depth: indentDepth(bullet[1]), spans: parseInline(bullet[2]) };
    }

    // 4. Ordered list item — `1.` and `1)` are both CommonMark.
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      return {
        type: "ordered",
        marker: ordered[2],
        depth: indentDepth(ordered[1]),
        spans: parseInline(ordered[3]),
      };
    }

    // 5. Blockquote.
    const quote = QUOTE_RE.exec(line);
    if (quote) return { type: "quote", spans: parseInline(quote[1]) };

    // 6. Blank line — a paragraph break, not an empty text node.
    if (line.trim().length === 0) return { type: "gap" };

    return { type: "para", spans: parseInline(line) };
  });
}

/**
 * Whether a link target is safe to hand to `Linking.openURL`.
 *
 * Link hrefs in a Coach reply are model output, not app-authored, so they're
 * treated as untrusted: only the web/mail/phone schemes a Coach reply has any
 * legitimate reason to use are openable. Anything else (`goalslot://`,
 * `javascript:`, `file:`, a bare relative path) still renders its label as
 * text — it just isn't tappable, so model output can never drive an
 * in-app deep link or a scheme handler.
 */
export function isSafeHref(href: string): boolean {
  return /^(https?|mailto|tel):/i.test(href.trim());
}

function spansToText(spans: InlineSpan[]): string {
  return spans.map((span) => span.text).join("");
}

/**
 * The same content with every markdown marker removed — what a screen reader
 * should hear. Without this, TalkBack/VoiceOver announces the accessibility
 * label as "hash hash hash What Worked colon", i.e. exactly the bug sighted
 * users reported, just in audio.
 */
export function toPlainText(text: string): string {
  return parseBlocks(text)
    .map((block) => (block.type === "rule" || block.type === "gap" ? "" : spansToText(block.spans)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
