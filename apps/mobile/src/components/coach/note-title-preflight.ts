// "Which page is the Coach about to write into?", answered on the card,
// BEFORE the user presses Apply.
//
// WHY THIS EXISTS. An APPEND_NOTE_CONTENT action carries only `titleHint` —
// whatever the user called the page, as the model heard it. The Coach is not
// given the user's note titles at all (a deliberate server-side choice; see
// goal-slot-api/src/modules/notes/note-content.ts's header), so it can and
// does invent names: a user with a page called "Tech to learn" was told the
// Coach would append to "your learning notes", a page that does not exist.
// The failure only surfaced after they pressed Apply — and in the incident
// that prompted this, not even then, because no card rendered at all.
//
// The user's own words: "if it heard wrong it gives error instead of saying
// no notes exists". This is that, said before the write instead of after.
//
// WHAT THIS IS NOT: it is not a second matcher, and it never decides
// anything. The server's `matchNotesByTitle` remains the only thing that
// picks a page. This mirrors the two tiers that function has always had —
// exact title, then substring in either direction — purely to decide whether
// to show a warning, and it stays SILENT unless BOTH tiers come up empty or
// genuinely ambiguous. If the server's matching is later made looser (there
// is active work on exactly that), the worst this can do is warn about a
// hint that would in fact have landed; it can never suppress a warning for
// one that wouldn't. The copy is worded as an observation about the user's
// page names, not as a prediction of failure, for the same reason.
//
// It is also silent when the notes list hasn't been fetched — a warning
// derived from an empty cache would be a warning derived from ignorance.

import { resolveSpokenTarget, type TargetCandidate } from "@goalslot/shared";

/** The same three-line rule `normalizeTitleForMatch` applies server-side. */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface NoteTitlePreflight {
  /** 'no-match': nothing in the user's Notes fits. 'ambiguous': several do. */
  kind: "no-match" | "ambiguous";
  message: string;
}

/** How many page names a message will list before it stops being readable. */
const MAX_LISTED = 3;

function quoteList(titles: readonly string[]): string {
  return titles
    .slice(0, MAX_LISTED)
    .map((t) => `"${t}"`)
    .join(", ");
}

/**
 * The nearest page NAMES by the voice matcher's phonetic/edit-distance
 * scoring — used ONLY to suggest, never to decide.
 *
 * The floor is deliberately well below `resolveSpokenTarget`'s own default
 * (0.6): that default is tuned for a matcher that is about to WRITE somewhere,
 * and nothing here writes anything. The real case this has to clear is
 * "learning notes" vs the user's "Tech to learn", which scores 0.43 — under
 * the acting threshold, comfortably over this one, and still far enough above
 * an unrelated hint ("quarterly board minutes" clears nothing) that the
 * suggestion stays meaningful rather than becoming a list of every page.
 *
 * Two names, not one: the top two are routinely within a few points of each
 * other, so presenting one as THE answer would be a confidence the score does
 * not support. They are offered as "closest names", which is exactly what
 * they are.
 */
const SUGGESTION_MIN_SCORE = 0.35;
const MAX_SUGGESTIONS = 2;

function closestByVoiceMatcher(titleHint: string, noteTitles: readonly string[]): string[] {
  const candidates: TargetCandidate[] = noteTitles.map((name, index) => ({
    id: String(index),
    name,
    kind: "note" as const,
  }));
  const resolution = resolveSpokenTarget({ kind: "note", name: titleHint }, candidates, {
    minScore: SUGGESTION_MIN_SCORE,
    maxCandidates: MAX_SUGGESTIONS,
  });
  return resolution.candidates.map((candidate) => candidate.name);
}

/**
 * A warning to render under an APPEND_NOTE_CONTENT row, or null when the hint
 * plainly resolves (or when there is nothing trustworthy to say).
 */
export function describeNoteTitlePreflight(
  titleHint: string | null | undefined,
  noteTitles: readonly string[],
): NoteTitlePreflight | null {
  if (typeof titleHint !== "string") return null;
  const hint = normalizeTitle(titleHint);
  if (hint.length === 0) return null;
  // Cold cache: say nothing rather than claim the user has no pages.
  if (noteTitles.length === 0) return null;

  const exact = noteTitles.filter((title) => normalizeTitle(title) === hint);
  if (exact.length === 1) return null;
  if (exact.length > 1) {
    return {
      kind: "ambiguous",
      message: `You have ${exact.length} pages named "${titleHint}". Applying will ask you to pick one.`,
    };
  }

  // Empty-titled pages are excluded from the substring tier for the same
  // reason the server excludes them: a blank title is a substring of every
  // hint, so it would otherwise match everything.
  const partial = noteTitles.filter((title) => {
    const normalized = normalizeTitle(title);
    return normalized.length > 0 && (normalized.includes(hint) || hint.includes(normalized));
  });
  if (partial.length === 1) return null;
  if (partial.length > 1) {
    return {
      kind: "ambiguous",
      message: `More than one page matches "${titleHint}": ${quoteList(partial)}. Say or type the exact title to be sure.`,
    };
  }

  const closest = closestByVoiceMatcher(titleHint, noteTitles);
  return {
    kind: "no-match",
    message:
      closest.length === 0
        ? `No page called "${titleHint}" in your Notes. Create it first, or ask again using the page's exact title.`
        : `No page called "${titleHint}" in your Notes. Closest names: ${quoteList(closest)}. Ask again naming the one you meant.`,
  };
}
