// Pure copy + logic for the Journal screen's writing-help features, ported
// from goal-slot-web's src/features/journal/components/journal-untangle.tsx,
// journal-entry-editor.tsx, and journal-affirmations.tsx. All static copy,
// no AI/backend calls anywhere — same as the web version.
//
// Split out of app/(app)/journal.tsx for the same reason recent-entries.ts
// was: this repo unit-tests its extracted pure layers rather than rendering
// screens, and the date-hashed prompt selection is exactly the kind of thing
// worth a regression test (two different days must not collide by accident,
// and the same day must always come back the same prompt).

/** One "Untangle a feeling" starter prompt. Rendered collapsed (title only) until tapped. */
export interface UntanglePrompt {
  id: string;
  title: string;
  body: string;
}

/**
 * Ported verbatim from journal-untangle.tsx's `PROMPTS` array — same ids,
 * titles, and bodies as web, so the two apps read as the same product. Web
 * additionally tags each with an internal-only `principle` field (never
 * rendered anywhere, bookkeeping only) — dropped here since nothing on
 * either platform displays it.
 */
export const UNTANGLE_PROMPTS: UntanglePrompt[] = [
  {
    id: "name-it",
    title: "Name the feeling out loud",
    body: "Write what you're actually feeling in one or two words — not the story around it, just the feeling. Then ask: what question is this feeling trying to make me answer?",
  },
  {
    id: "in-out",
    title: "Inside your control, outside your control",
    body: "Draw two columns. On the left, list what about this is up to you. On the right, what isn't. Cross out the right column and look only at the left.",
  },
  {
    id: "real-intention",
    title: "What was I actually trying to do?",
    body: "Forget the outcome for a minute. What was the intention going in? If you could rewind, would you keep it? If yes, the result doesn't define the action. If no, that's the lesson.",
  },
  {
    id: "sit-with-it",
    title: "Don't fix it. Sit with it.",
    body: "Resist the urge to solve this right now. Describe the feeling like you'd describe weather — without judgement. What does it want you to notice? Three sentences.",
  },
  {
    id: "friend-mirror",
    title: "If a friend told you this, what would you say back?",
    body: "Write it out in their voice, telling you their version. Then write your reply. Read it back to yourself slowly.",
  },
  {
    id: "tiny-quiet-thing",
    title: "Three quiet things that are still working",
    body: "List three things that didn't go wrong today — small ones count. The roof. A hot drink. Someone who text back. Notice what would be missed if it stopped.",
  },
  {
    id: "one-step",
    title: "One small adjustment for tomorrow",
    body: "Not a new self. Not a plan. One small adjustment. What's the next 1% — the kind of change that's still you, just slightly aimed?",
  },
  {
    id: "enough-as-is",
    title: "What if this is exactly what was supposed to happen?",
    body: "Sit with the possibility — without arguing with it — that the moment you're in is the one you were meant to be in. What does it shift, if you let that be true for a minute?",
  },
  {
    id: "remember-when",
    title: "A time things felt like this and then changed",
    body: "Find a memory where the feeling you have now showed up before — and then passed. Write what eventually shifted. Feelings are weather, not climate.",
  },
  {
    id: "someone-quiet",
    title: "Who's helping that you haven't thanked?",
    body: "Name one person whose small steady presence you've been quietly relying on. What would you write to them if you weren't going to send it?",
  },
];

/**
 * Ported verbatim from journal-entry-editor.tsx's `PROMPTS` — the 5 generic
 * daily-placeholder prompts, in the same order web hashes over.
 */
export const DAILY_PLACEHOLDER_PROMPTS: readonly string[] = [
  "What's on your mind today?",
  "Write whatever wants to come out, a sentence or a page.",
  "What worked? What got in the way?",
  "How do you actually feel right now?",
  "What did you learn today?",
];

/**
 * Deterministic pick so the placeholder is stable per day — ported bit-for-
 * bit from journal-entry-editor.tsx's own `promptForDate` (same multiplier,
 * same `>>> 0` unsigned-coercion, same modulo). Given the same "YYYY-MM-DD"
 * date key and the same `DAILY_PLACEHOLDER_PROMPTS` order, this returns the
 * exact same prompt web shows for that day — so a user who journals from
 * both platforms sees one placeholder, not two.
 */
export function promptForDate(date: string): string {
  let hash = 0;
  for (let i = 0; i < date.length; i++) hash = (hash * 31 + date.charCodeAt(i)) >>> 0;
  return DAILY_PLACEHOLDER_PROMPTS[hash % DAILY_PLACEHOLDER_PROMPTS.length];
}

/**
 * Ported verbatim from journal-affirmations.tsx's `AFFIRMATIONS` — same 6
 * phrases, same order, cross-faded on the same ~8s cadence by
 * JournalAffirmations.tsx.
 */
export const JOURNAL_AFFIRMATIONS: readonly string[] = [
  "Relax and write.",
  "Untangle a thought.",
  "Nothing leaves here.",
  "A sentence is enough.",
  "Today doesn't have to be tidy.",
  "Write the noisy version first.",
];

/**
 * Formats one Untangle prompt as plain text for insertion into the journal
 * draft. Web inserts formatted HTML (`<p><strong>title</strong></p><p><em>
 * body</em></p>`) into a TipTap document; this screen's editor is a plain
 * multiline TextInput (see journal.tsx's own header comment — it never
 * rendered TipTap formatting even for web-authored entries), so there is no
 * bold/italic to carry over. Title and body on their own line each, same
 * two-part shape as web's rendering, just without the markup.
 */
export function formatUntanglePromptForInsert(prompt: UntanglePrompt): string {
  return `${prompt.title}\n${prompt.body}`;
}

/**
 * Appends a formatted Untangle prompt block to the end of the existing
 * draft.
 *
 * v1 simplification: web inserts at the live cursor position (Tiptap keeps
 * the ProseMirror selection even while the picker dialog has DOM focus).
 * This screen's editor is a plain, controlled RN `TextInput` — reading back
 * the *current* selection at the moment the sheet was opened is possible via
 * `onSelectionChange`, but the sheet stays open across taps (expand a card,
 * read it, decide, insert) and RN does not guarantee a stale selection index
 * is still valid against a draft that may have changed in between. Appending
 * to the end avoids that whole class of "insert landed at a now-wrong
 * offset" bug for a first version, at the cost of not honouring mid-entry
 * cursor placement — same trade-off `appendDictatedPhrase` in journal.tsx
 * already makes for voice dictation, which this mirrors: existing content is
 * never edited, only extended, and a blank draft just becomes the block.
 */
export function appendUntanglePrompt(existing: string, prompt: UntanglePrompt): string {
  const block = formatUntanglePromptForInsert(prompt);
  if (existing.trim().length === 0) return block;
  const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${block}`;
}
