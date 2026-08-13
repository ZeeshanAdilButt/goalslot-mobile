// Spoken name -> one of the user's actual goals or tasks.
//
// This is the half that matters most, and the reason this feature exists at
// all: the complaint that started it was not "I want to talk to my phone",
// it was that a goal called "deen" could not be found in a picker. A voice
// command that starts an unattributed timer because it could not find
// "deen" has reproduced the original bug with a microphone attached.
//
// So there is no silent failure and no coin flip. Every resolution comes
// back as one of three answers, and the caller has to handle all three:
//
//   confident          one clear winner, act on it
//   needs-confirmation something matched, but not well enough or not
//                      distinctly enough to act unasked — show it and ask
//   unresolved         nothing matched — say what was heard, offer the
//                      nearest names, never invent one
//
// `candidates` carries the ranked runners-up in every case, so "which one
// did you mean?" is always answerable without a second pass.
//
// Contract-compatible with `jiffy-voice`'s TargetResolver (see ./intent.ts's
// header for why that package is not a dependency yet). `resolve()` there
// returns best-or-null; this returns the classification plus the ranking,
// which is the shape that package's resolver is growing.

import { foldText, DEFAULT_KIND_WORDS } from './parse'
import type { NamedTarget, TargetKind } from './intent'

/**
 * One of the host's records, flattened to the parts matching needs. Aliases
 * cover the names people actually say for a record stored under something
 * longer or more formal.
 */
export interface TargetCandidate {
  readonly id: string
  readonly name: string
  readonly kind: TargetKind
  readonly aliases?: readonly string[]
}

export interface ResolvedTarget {
  readonly id: string
  readonly name: string
  readonly kind: TargetKind
  /** 0..1. How close the spoken name was to this record's name or an alias. */
  readonly score: number
  /** Which string actually matched — the record's name, or one of its aliases. */
  readonly matchedOn: string
}

export type TargetResolutionStatus = 'confident' | 'needs-confirmation' | 'unresolved'

export interface TargetResolution {
  readonly status: TargetResolutionStatus
  /** The winner. Null only when `status` is 'unresolved'. */
  readonly target: ResolvedTarget | null
  /** Everything that scored at or above the floor, best first, winner included. */
  readonly candidates: readonly ResolvedTarget[]
  /** Why confirmation is being asked for. Absent when `status` is 'confident'. */
  readonly reason?: 'ambiguous' | 'weak-match' | 'no-match'
}

/**
 * Below this, a match is a coincidence. Chosen against the transcription
 * errors this is meant to survive: a one-letter miss on a short name lands
 * near 0.75, so 0.6 leaves room for a worse recognizer without letting an
 * unrelated name through.
 */
const DEFAULT_MIN_SCORE = 0.6

/**
 * At or above this, act without asking. Below it (but above the floor) the
 * match is real enough to show and too soft to run a timer on unasked.
 */
const DEFAULT_CONFIDENT_SCORE = 0.82

/**
 * How far ahead of the runner-up the winner has to be. Two names this close
 * mean the recording did not distinguish them, and starting a timer on a
 * coin flip is worse than asking.
 */
const DEFAULT_AMBIGUITY_MARGIN = 0.08

/** Ranked lists longer than this are noise in a "did you mean?" prompt. */
const MAX_CANDIDATES = 4

const PHONETIC_SCORE = 0.85

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Optimal string alignment distance: Levenshtein plus adjacent
 * transpositions, so "detail" against "detial" costs one edit rather than
 * two. Transposition matters because it is what a fast talker and a
 * real-time recognizer both produce.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const distance = new Array<number>(rows * cols).fill(0)

  const get = (row: number, col: number): number => distance[row * cols + col] ?? 0
  const set = (row: number, col: number, value: number): void => {
    distance[row * cols + col] = value
  }

  for (let row = 0; row < rows; row += 1) set(row, 0, row)
  for (let col = 0; col < cols; col += 1) set(0, col, col)

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      let best = Math.min(get(row - 1, col) + 1, get(row, col - 1) + 1, get(row - 1, col - 1) + cost)
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        best = Math.min(best, get(row - 2, col - 2) + 1)
      }
      set(row, col, best)
    }
  }

  return get(rows - 1, cols - 1)
}

function editRatio(a: string, b: string): number {
  if (a === b) return 1
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 0
  return 1 - editDistance(a, b) / longest
}

function sortTokens(text: string): string {
  return text.split(' ').sort().join(' ')
}

/**
 * The same text with every space closed up.
 *
 * Where a name is split is the single thing a recognizer is least reliable
 * about on an invented brand name, because it has no dictionary entry to
 * anchor on: "OloStep" comes back as "olo step" as readily as "olostep", and
 * a goal stored as "Olo Step" hits the same problem in reverse. Comparing
 * the spaceless skeletons makes that difference cost nothing, which is what
 * "whitespace-insensitive" has to mean — the token-wise comparisons above
 * cannot see it, since they are built on the very split that moved.
 *
 * This is a floor, never a ceiling: it joins the max() below, so it can only
 * rescue a pair the other readings undersold. It stays honest about
 * genuinely different names because it is still an edit ratio over the whole
 * string — "deen" against "deenfitnesstracker" scores 0.22, not 1.
 */
function compact(text: string): string {
  return text.replace(/ /g, '')
}

/** How much of `from`, weighted by word length, is accounted for by `to`. */
function coverage(from: readonly string[], to: readonly string[]): number {
  let matched = 0
  let total = 0
  for (const token of from) {
    let best = 0
    for (const other of to) best = Math.max(best, editRatio(token, other))
    matched += token.length * best
    total += token.length
  }
  return total === 0 ? 0 : matched / total
}

/**
 * Harmonic mean of the two coverages, which stops a single matching word
 * from carrying a much longer name: "deen" covers all of itself inside "deen
 * fitness tracker", but that name is mostly words the speaker never said,
 * and the low reverse coverage drags the result back down.
 */
function tokenOverlap(a: string, b: string): number {
  const forward = coverage(a.split(' '), b.split(' '))
  const backward = coverage(b.split(' '), a.split(' '))
  if (forward + backward === 0) return 0
  return (2 * forward * backward) / (forward + backward)
}

function consonantSkeleton(word: string): string {
  const collapsed = word.replace(/(.)\1+/g, '$1')
  return collapsed.slice(0, 1) + collapsed.slice(1).replace(/[aeiou]/g, '')
}

/**
 * A recognizer that hears "dean" for "deen" produced a string that is close
 * in edit distance but exactly right in sound, and the vowels it got wrong
 * are the ones it is least reliable about.
 */
function soundsTheSame(a: string, b: string): boolean {
  const left = a.split(' ').map(consonantSkeleton).join(' ')
  const right = b.split(' ').map(consonantSkeleton).join(' ')
  return left.length >= 2 && left === right && a.slice(0, 1) === b.slice(0, 1)
}

/** How alike two names are, 0..1, after folding both. Pure and deterministic. */
export function nameSimilarity(a: string, b: string): number {
  const left = foldText(a)
  const right = foldText(b)
  if (left.length === 0 || right.length === 0) return 0
  if (left === right) return 1

  return round(
    Math.max(
      editRatio(left, right),
      editRatio(sortTokens(left), sortTokens(right)),
      editRatio(compact(left), compact(right)),
      tokenOverlap(left, right),
      soundsTheSame(left, right) ? PHONETIC_SCORE : 0,
    ),
  )
}

export interface ResolveTargetOptions {
  readonly minScore?: number
  readonly confidentScore?: number
  readonly ambiguityMargin?: number
  readonly maxCandidates?: number
  readonly kindWords?: Readonly<Record<string, TargetKind>>
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Ties break by name and then by id, so an equally good pair always comes
 * back in the same order. Without it the answer would depend on whatever
 * order the caller happened to hand its records over in, and the same
 * utterance could resolve differently between two calls.
 */
function byScoreThenName(a: ResolvedTarget, b: ResolvedTarget): number {
  return b.score - a.score || compareStrings(a.name, b.name) || compareStrings(a.id, b.id)
}

/**
 * The spoken name, plus the same name without the word saying what kind of
 * thing it is. A caller may not have stripped "goal" off "dean goal", and
 * that trailing word should not cost it the match.
 */
function variantsOf(name: string, kindWords: Readonly<Record<string, TargetKind>>): readonly string[] {
  const folded = foldText(name)
  if (folded.length === 0) return []

  const tokens = folded.split(' ')
  const variants = new Set([folded])
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1]
    if (last !== undefined && kindWords[last] !== undefined) variants.add(tokens.slice(0, -1).join(' '))
    const first = tokens[0]
    if (first !== undefined && kindWords[first] !== undefined) variants.add(tokens.slice(1).join(' '))
  }
  return [...variants]
}

function bestMatch(spoken: readonly string[], candidate: TargetCandidate): { score: number; matchedOn: string } {
  let best = { score: 0, matchedOn: candidate.name }
  for (const known of [candidate.name, ...(candidate.aliases ?? [])]) {
    for (const said of spoken) {
      const score = nameSimilarity(said, known)
      if (score > best.score) best = { score, matchedOn: known }
    }
  }
  return best
}

/** Every candidate scoring at or above the floor, best first. */
export function rankTargets(
  target: NamedTarget,
  candidates: readonly TargetCandidate[],
  options: ResolveTargetOptions = {},
): readonly ResolvedTarget[] {
  const kindWords = options.kindWords ?? DEFAULT_KIND_WORDS
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const spoken = variantsOf(target.name, kindWords)
  if (spoken.length === 0) return []

  const matches: ResolvedTarget[] = []
  for (const candidate of candidates) {
    // 'category' never reaches the timer, so a spoken kind the caller does
    // not supply simply matches nothing rather than erroring.
    if (target.kind !== 'unspecified' && candidate.kind !== target.kind) continue
    const match = bestMatch(spoken, candidate)
    if (match.score < minScore) continue
    matches.push({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
      score: match.score,
      matchedOn: match.matchedOn,
    })
  }

  return matches.sort(byScoreThenName)
}

/**
 * Classifies a spoken name against the user's records. Never returns a
 * winner it is not prepared to defend: a soft match and a photo-finish both
 * come back as 'needs-confirmation' with the ranking attached, and nothing
 * at all comes back as 'unresolved' rather than as the least-bad guess.
 */
export function resolveSpokenTarget(
  target: NamedTarget,
  candidates: readonly TargetCandidate[],
  options: ResolveTargetOptions = {},
): TargetResolution {
  const confidentScore = options.confidentScore ?? DEFAULT_CONFIDENT_SCORE
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES

  const ranked = rankTargets(target, candidates, options).slice(0, maxCandidates)
  const best = ranked[0]

  if (best === undefined) {
    // Nothing cleared the floor. The near-misses below the floor are
    // deliberately not offered: a list of things that sound nothing like
    // what was said is worse than admitting the name wasn't recognised.
    return { status: 'unresolved', target: null, candidates: [], reason: 'no-match' }
  }

  const runnerUp = ranked[1]
  if (runnerUp !== undefined && best.score - runnerUp.score < ambiguityMargin) {
    return { status: 'needs-confirmation', target: best, candidates: ranked, reason: 'ambiguous' }
  }

  if (best.score < confidentScore) {
    return { status: 'needs-confirmation', target: best, candidates: ranked, reason: 'weak-match' }
  }

  return { status: 'confident', target: best, candidates: ranked }
}
