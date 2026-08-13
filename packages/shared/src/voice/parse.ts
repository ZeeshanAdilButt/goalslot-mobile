// Transcript -> typed tracking intent. Rule-based and deterministic: the
// same words always produce the same command, which is what lets a voice
// button act without asking, and what lets a wrong reading be reproduced
// from a log line instead of shrugged at.
//
// See ./intent.ts's header for why this lives here rather than coming from
// the `jiffy-voice` package. The rule table, the refusals, and the
// confidence adjustments below follow that package's rule-based adapter.
//
// The governing rule, and the reason this is a table rather than a model
// call: acting on a misread command costs a user more than being asked to
// repeat themselves. Anything not accounted for comes back UNKNOWN, and the
// caller falls through to the full Coach pipeline (which confirms before it
// mutates) rather than guessing.

import {
  clampConfidence,
  namedTarget,
  NO_TARGET,
  unknownIntent,
  type ActionableVoiceIntent,
  type IntentTarget,
  type SpokenTargetKind,
  type TargetKind,
  type VoiceIntent,
} from './intent'

/**
 * The words English uses to say what type of thing was just named. The
 * parser needs them to read the kind out of "my deen goal"; the resolver
 * needs the same vocabulary so a caller passing a raw spoken phrase is not
 * punished for the word "goal" still being attached.
 */
export const DEFAULT_KIND_WORDS: Readonly<Record<string, TargetKind>> = {
  goal: 'goal',
  goals: 'goal',
  objective: 'goal',
  task: 'task',
  tasks: 'task',
  todo: 'task',
  item: 'task',
  category: 'category',
  categories: 'category',
  project: 'category',
  bucket: 'category',
  area: 'category',
}

const COMBINING_MARKS = /[̀-ͯ]/g
const APOSTROPHES = /['‘’ʼ]/g
const NON_FOLDABLE = /[^a-z0-9\s]/g

/**
 * Reduces text to the lowercase alphanumeric skeleton matching works on.
 * Both sides of every comparison go through here, which is the point: a goal
 * stored as "Qur'an Study" and a transcript reading "quran study" have to
 * fold to the same thing or nothing else matters.
 *
 * Apostrophes close up rather than becoming spaces, so "deen's" folds to
 * "deens" on both sides instead of to a word only one side has.
 */
export function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(NON_FOLDABLE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(input: string): string[] {
  const folded = foldText(input)
  return folded.length === 0 ? [] : folded.split(' ')
}

/**
 * Sounds people make while thinking. Dropped wherever they appear, unlike
 * the phrases below which are only dropped at an edge. "like" and "so" are
 * deliberately absent: both turn up inside real names, and a parser that
 * quietly edits the middle of a name is worse than one that takes an extra
 * word.
 */
const DISFLUENCIES = new Set(['um', 'uh', 'uhm', 'erm', 'er', 'ah', 'eh', 'hmm', 'mm', 'mmm'])

/** Politeness and throat-clearing, only ever stripped from the front. */
const LEADING_PHRASES: readonly string[] = [
  'hey there',
  'hey',
  'hi',
  'hello',
  'yo',
  'yeah',
  'yep',
  'ok',
  'okay',
  'so',
  'well',
  'alright',
  'all right',
  'please',
  'just',
  'now',
  'can you',
  'could you',
  'would you',
  'will you',
  'i want to',
  'i would like to',
  'id like to',
  'i need to',
  'lets',
  'let us',
  'go ahead and',
]

/** Only ever stripped from the end. */
const TRAILING_PHRASES: readonly string[] = [
  'please',
  'thanks',
  'thank you',
  'for me',
  'will you',
  'ok',
  'okay',
  'alright',
]

interface CommandRule {
  readonly phrase: readonly string[]
  readonly type: ActionableVoiceIntent['type']
  /**
   * Ordinary enough in unrelated speech that matching it is a guess worth
   * discounting. "Done" almost always means stop; it also turns up in the
   * middle of someone thinking out loud.
   */
  readonly weak: boolean
  /**
   * Meaningless without a quantity of time. "Log" with no duration is not a
   * command to start a timer, it is an unfinished sentence.
   */
  readonly needsDuration: boolean
}

interface RuleGroup {
  readonly type: ActionableVoiceIntent['type']
  readonly phrases: readonly string[]
  readonly weakPhrases?: readonly string[]
  readonly needsDuration?: boolean
}

const RULE_GROUPS: readonly RuleGroup[] = [
  {
    type: 'START_TRACKING',
    phrases: [
      'start tracking time for',
      'start tracking time',
      'start tracking',
      'start working on',
      'start work on',
      'start the timer',
      'start a timer',
      'start timer',
      'start the clock',
      'start',
      'begin tracking time',
      'begin tracking',
      'begin working on',
      'begin',
      'clock in on',
      'clock into',
      'clock in',
      'punch in',
      'switch over to',
      'switch to',
      'new timer for',
      'new timer',
    ],
    weakPhrases: ['track time on', 'track time', 'track', 'im working on', 'i am working on', 'working on', 'work on'],
  },
  {
    type: 'STOP_TRACKING',
    phrases: [
      'stop tracking time',
      'stop tracking',
      'stop working on',
      'stop the timer',
      'stop timer',
      'stop the clock',
      'stop the session',
      'stop',
      'end tracking',
      'end the timer',
      'end timer',
      'end the session',
      'end session',
      'finish tracking',
      'clock out of',
      'clock out',
      'punch out',
      'im finished',
      'i am finished',
      'im done',
      'i am done',
    ],
    weakPhrases: ['end', 'finish up', 'finish', 'finished', 'done', 'thats it', 'wrap up'],
  },
  {
    type: 'PAUSE',
    phrases: ['pause tracking', 'pause the timer', 'pause timer', 'pause', 'take a break', 'hold the timer'],
    weakPhrases: ['hold on'],
  },
  {
    type: 'RESUME',
    phrases: [
      'resume tracking',
      'resume the timer',
      'resume timer',
      'resume',
      'unpause',
      'un pause',
      'continue tracking',
      'continue the timer',
      'continue timer',
      'start again',
      'back to work',
    ],
    weakPhrases: ['continue', 'keep going', 'carry on', 'im back', 'i am back'],
  },
  {
    type: 'LOG_TIME',
    needsDuration: true,
    phrases: ['log', 'record', 'bill', 'credit', 'ive spent', 'i spent', 'spent', 'i worked', 'worked for', 'worked'],
  },
]

function toRules(group: RuleGroup): CommandRule[] {
  const needsDuration = group.needsDuration ?? false
  const strong = group.phrases.map((phrase) => ({
    phrase: phrase.split(' '),
    type: group.type,
    weak: false,
    needsDuration,
  }))
  const weak = (group.weakPhrases ?? []).map((phrase) => ({
    phrase: phrase.split(' '),
    type: group.type,
    weak: true,
    needsDuration,
  }))
  return [...strong, ...weak]
}

/**
 * Longest phrase first, which is the whole of the disambiguation strategy:
 * "start again" is a resume and "start tracking" is not, and both would
 * match the bare "start" rule if a shorter phrase were tried first.
 *
 * Explicit phrases beat hedged ones of the same length, so a rule the user
 * clearly said is never lost to one that merely happens to be as long. Ties
 * beyond that keep the table's own order, which makes the sort total and the
 * parse reproducible from a log line rather than dependent on the engine's
 * sort.
 */
const COMMAND_RULES: readonly CommandRule[] = RULE_GROUPS.flatMap(toRules)
  .map((rule, index) => ({ rule, index }))
  .sort(
    (a, b) =>
      b.rule.phrase.length - a.rule.phrase.length ||
      Number(a.rule.weak) - Number(b.rule.weak) ||
      a.index - b.index,
  )
  .map(({ rule }) => rule)

const BASE_CONFIDENCE = 0.9
const EXACT_PHRASE_BONUS = 0.05
const LEADING_NOISE_PENALTY = 0.1
const WEAK_PHRASE_PENALTY = 0.15
const ASSUMED_UNIT_PENALTY = 0.1

/**
 * How far past the start a command phrase may sit and still be believed.
 * Beyond a few words of preamble the match is more likely a coincidence
 * inside a sentence about something else than a command.
 */
const MAX_LEAD_TOKENS = 3

const DETERMINERS = new Set(['my', 'our', 'the', 'a', 'an', 'this', 'that', 'some', 'it'])

const CONNECTIVES = new Set([
  'on',
  'in',
  'at',
  'to',
  'for',
  'of',
  'from',
  'into',
  'onto',
  'against',
  'toward',
  'towards',
  'with',
])

/**
 * Dropped only when what follows is itself connective tissue. "Start
 * tracking my time on the deen goal" has a throwaway "time"; "start tracking
 * my time management goal" does not, and stripping unconditionally would
 * rename the goal.
 */
const CONTEXTUAL_NOISE = new Set(['time'])

/**
 * Generic words for the activity itself rather than the thing it is aimed
 * at. "Start tracking time for my work for OloStep" names OloStep — the
 * "work" is the same throwaway noun as the "time" before it, and reading it
 * as part of the name produces "work for olostep", which matches the real
 * goal too poorly to act on and drags an unrelated goal called "Work" into
 * the ranking beside it. That soft, contested match is what sends a plain
 * "start a timer" down the Coach's path and back as a proposal to edit the
 * schedule.
 *
 * Unlike CONTEXTUAL_NOISE these are only dropped when a connective AND a
 * real name follow, because a goal genuinely called "Work" is ordinary:
 * "start tracking my work" still names it, and only "start tracking my work
 * for X" gives it up in favour of X.
 */
const ACTIVITY_NOISE = new Set(['work', 'works', 'working', 'tracking'])

const TRAILING_NOISE = new Set(['now', 'today', 'tonight', 'again', 'already'])

/**
 * A question is not a command, whatever verbs it happens to contain. "What
 * did I work on yesterday" would otherwise match the "work on" rule and
 * start a timer on something called "yesterday".
 *
 * "Can" and "could" are absent on purpose: "can you start tracking deen" is
 * a request, and normalization has already taken the polite opening off it.
 */
const INTERROGATIVES = new Set([
  'what',
  'whats',
  'when',
  'where',
  'why',
  'how',
  'who',
  'whom',
  'whose',
  'which',
  'did',
  'do',
  'does',
  'am',
  'is',
  'are',
  'was',
  'were',
  'should',
])

/**
 * Refused outright, ahead of every rule. "Cancel" is the one that matters:
 * it sits next to "stop" in a user's head and means the opposite thing to
 * the timer — one saves the session, the other throws it away.
 */
const REFUSED_OPENERS = new Set(['cancel', 'discard', 'delete', 'remove', 'undo', 'scrap', 'abandon'])

/**
 * Words for "a short unspecified while". "Pause for a moment" is a bare
 * pause, not a pause on something called "moment".
 */
const VAGUE_TIME = new Set([
  'moment',
  'moments',
  'sec',
  'secs',
  'second',
  'seconds',
  'minute',
  'minutes',
  'min',
  'mins',
  'bit',
  'while',
  'break',
  'breather',
])

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  forty5: 45,
  fortyfive: 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
}

const HOUR_UNITS = new Set(['hour', 'hours', 'hr', 'hrs', 'h'])
const MINUTE_UNITS = new Set(['minute', 'minutes', 'min', 'mins', 'm'])
const SECOND_UNITS = new Set(['second', 'seconds', 'sec', 'secs', 's'])

interface DurationMatch {
  readonly minutes: number
  /** Index range in the token array the duration occupied, end-exclusive. */
  readonly start: number
  readonly end: number
  /** True when a bare number had no unit and minutes were assumed. */
  readonly assumedUnit: boolean
}

function unitMinutes(token: string): number | null {
  if (HOUR_UNITS.has(token)) return 60
  if (MINUTE_UNITS.has(token)) return 1
  if (SECOND_UNITS.has(token)) return 1 / 60
  return null
}

const FRACTION_WORDS = new Set(['half', 'quarter', 'quarters'])

/**
 * "An hour" is one hour; "a while" is not one while. The indefinite article
 * only counts as the number one when a unit of time follows it, which is
 * what keeps "spent a while on deen" from parsing as a one-minute log
 * against a goal called "while on deen".
 */
function numberAt(tokens: readonly string[], index: number): number | null {
  const token = tokens[index]
  if (token === undefined) return null
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token)
  if (token === 'a' || token === 'an') {
    const next = tokens[index + 1]
    const introducesTime = next !== undefined && (unitMinutes(next) !== null || FRACTION_WORDS.has(next))
    return introducesTime ? 1 : null
  }
  const word = NUMBER_WORDS[token]
  return word ?? null
}

/**
 * Finds one spoken quantity of time in a token run, reading the forms
 * people actually use: "30 minutes", "1 hour 30", "an hour and a half",
 * "half an hour", "a quarter of an hour", "90 seconds", and a bare "30"
 * (assumed minutes, and penalised for it).
 *
 * Returns the token span too, so the caller can lift the duration out and
 * leave the rest of the sentence as the target's name.
 */
export function findSpokenDuration(tokens: readonly string[]): DurationMatch | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined) continue

    // "half an hour" / "a quarter of an hour" / "three quarters of an hour"
    const fraction = token === 'half' ? 0.5 : FRACTION_WORDS.has(token) ? 0.25 : null
    if (fraction !== null) {
      const multiplier = i > 0 ? (numberAt(tokens, i - 1) ?? 1) : 1
      const start = i > 0 && numberAt(tokens, i - 1) !== null ? i - 1 : i
      for (let j = i + 1; j <= i + 3 && j < tokens.length; j += 1) {
        const unit = tokens[j]
        if (unit === undefined) continue
        const perUnit = unitMinutes(unit)
        if (perUnit !== null) {
          return { minutes: fraction * multiplier * perUnit, start, end: j + 1, assumedUnit: false }
        }
      }
      continue
    }

    const value = numberAt(tokens, i)
    if (value === null) continue

    const next = tokens[i + 1]
    const perUnit = next === undefined ? null : unitMinutes(next)
    if (perUnit === null) {
      // A bare number, e.g. "log 30 to deen". Only believable when it opens
      // the run — a number buried inside a name ("sprint 3") is not a
      // duration.
      if (i === 0) return { minutes: value, start: i, end: i + 1, assumedUnit: true }
      continue
    }

    let minutes = value * perUnit
    let end = i + 2

    // "an hour and a half", "1 hour 30", "one hour and 30 minutes"
    let cursor = end
    if (tokens[cursor] === 'and') cursor += 1
    // The article in "and a half" belongs to the fraction, not to a count of
    // anything — skipping it is what stops "a" being read as the number one
    // and turning ninety minutes into sixty-one.
    const article = tokens[cursor]
    const afterArticle = tokens[cursor + 1]
    if ((article === 'a' || article === 'an') && afterArticle !== undefined && FRACTION_WORDS.has(afterArticle)) {
      cursor += 1
    }
    const tail = tokens[cursor]
    if (perUnit === 60 && tail !== undefined && FRACTION_WORDS.has(tail)) {
      minutes += tail === 'half' ? 30 : 15
      end = cursor + 1
    } else {
      const tailValue = numberAt(tokens, cursor)
      if (tailValue !== null && perUnit === 60) {
        const tailUnit = tokens[cursor + 1]
        const tailPerUnit = tailUnit === undefined ? null : unitMinutes(tailUnit)
        minutes += tailValue * (tailPerUnit ?? 1)
        end = tailPerUnit === null ? cursor + 1 : cursor + 2
      }
    }

    return { minutes, start: i, end, assumedUnit: false }
  }

  return null
}

function matchesAt(tokens: readonly string[], index: number, phrase: readonly string[]): boolean {
  if (index < 0 || index + phrase.length > tokens.length) return false
  for (let offset = 0; offset < phrase.length; offset += 1) {
    if (tokens[index + offset] !== phrase[offset]) return false
  }
  return true
}

function splitPhrases(phrases: readonly string[]): readonly (readonly string[])[] {
  return phrases.map((phrase) => phrase.split(' '))
}

const LEADING = splitPhrases(LEADING_PHRASES)
const TRAILING = splitPhrases(TRAILING_PHRASES)

function stripLeading(tokens: readonly string[], phrases: readonly (readonly string[])[]): readonly string[] {
  let result = tokens
  let stripping = true
  while (stripping && result.length > 0) {
    stripping = false
    for (const phrase of phrases) {
      if (matchesAt(result, 0, phrase)) {
        result = result.slice(phrase.length)
        stripping = true
        break
      }
    }
  }
  return result
}

function stripTrailing(tokens: readonly string[], phrases: readonly (readonly string[])[]): readonly string[] {
  let result = tokens
  let stripping = true
  while (stripping && result.length > 0) {
    stripping = false
    for (const phrase of phrases) {
      if (matchesAt(result, result.length - phrase.length, phrase)) {
        result = result.slice(0, result.length - phrase.length)
        stripping = true
        break
      }
    }
  }
  return result
}

export interface ParseVoiceCommandOptions {
  /**
   * Words the app is addressed by, dropped from the front of an utterance.
   * Configurable because the name of the thing being spoken to belongs to
   * the host, not to the parser.
   */
  readonly wakeWords?: readonly string[]
  /** Replaces the default spoken-kind vocabulary wholesale. */
  readonly kindWords?: Readonly<Record<string, TargetKind>>
  /** Anything scoring below this is reported as UNKNOWN. Default 0. */
  readonly minConfidence?: number
}

function normalizeUtterance(transcript: string, wakeWords: readonly string[]): readonly string[] {
  const wake = splitPhrases(wakeWords.map(foldText).filter((word) => word.length > 0))
  const tokens = tokenize(transcript).filter((token) => !DISFLUENCIES.has(token))
  return stripTrailing(stripLeading(tokens, [...wake, ...LEADING]), TRAILING)
}

/**
 * True when something that could be a name still follows `from`, once the
 * connective tissue and the trailing throwaways are skipped. This is the
 * guard that makes giving a word up safe: "my work for OloStep" has a name
 * after the "for" and can spare the "work", while "my work for now" has
 * nothing behind the connective and must keep it.
 */
function hasNameAfter(tokens: readonly string[], from: number): boolean {
  for (let i = from; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined) return false
    if (DETERMINERS.has(token) || CONNECTIVES.has(token) || TRAILING_NOISE.has(token)) continue
    return true
  }
  return false
}

function stripTargetNoise(tokens: readonly string[]): readonly string[] {
  let start = 0
  let end = tokens.length

  while (start < end) {
    const token = tokens[start]
    if (token === undefined) break
    if (DETERMINERS.has(token) || CONNECTIVES.has(token)) {
      start += 1
      continue
    }
    if (CONTEXTUAL_NOISE.has(token)) {
      const next = tokens[start + 1]
      if (next === undefined || CONNECTIVES.has(next) || DETERMINERS.has(next)) {
        start += 1
        continue
      }
    }
    if (ACTIVITY_NOISE.has(token)) {
      // Only ever given up to a name that follows it: the connective is what
      // says the speaker is about to name the thing rather than still
      // describing the doing of it.
      const next = tokens[start + 1]
      if (next !== undefined && CONNECTIVES.has(next) && hasNameAfter(tokens, start + 1)) {
        start += 1
        continue
      }
    }
    break
  }

  // A name never ends in connective tissue. Stripping it matters once the
  // words in front can be given up: "my work for now" sheds the "now" and
  // would otherwise leave the goal named "work for".
  while (end > start) {
    const token = tokens[end - 1]
    if (token === undefined) break
    if (!TRAILING_NOISE.has(token) && !CONNECTIVES.has(token) && !DETERMINERS.has(token)) break
    end -= 1
  }

  return tokens.slice(start, end)
}

function extractTarget(
  tokens: readonly string[],
  kindWords: Readonly<Record<string, TargetKind>>,
): IntentTarget {
  const cleaned = stripTargetNoise(tokens)
  const first = cleaned[0]
  if (first === undefined) return NO_TARGET

  // A lone kind word names a type, not an instance: "start tracking my goal"
  // has not said which one.
  if (cleaned.length === 1) {
    return kindWords[first] === undefined ? namedTarget('unspecified', first) : NO_TARGET
  }

  const last = cleaned[cleaned.length - 1]
  const suffixKind = last === undefined ? undefined : kindWords[last]
  const prefixKind = kindWords[first]

  let kind: SpokenTargetKind = 'unspecified'
  let name = cleaned
  if (suffixKind !== undefined) {
    kind = suffixKind
    name = cleaned.slice(0, -1)
  } else if (prefixKind !== undefined) {
    kind = prefixKind
    name = cleaned.slice(1)
  }

  const trimmed = stripTargetNoise(name)
  if (trimmed.length === 0) return NO_TARGET

  return namedTarget(kind, trimmed.join(' '))
}

/** True when what follows the verb only qualifies it rather than naming anything. */
function isTimeQualifierOnly(tokens: readonly string[]): boolean {
  const cleaned = stripTargetNoise(tokens)
  if (cleaned.length === 0) return true
  if (cleaned.every((token) => VAGUE_TIME.has(token))) return true
  const duration = findSpokenDuration(cleaned)
  return duration !== null && duration.start === 0 && duration.end === cleaned.length
}

function findRule(tokens: readonly string[]): { rule: CommandRule; lead: number } | null {
  const maxLead = Math.min(MAX_LEAD_TOKENS, Math.max(tokens.length - 1, 0))
  for (let lead = 0; lead <= maxLead; lead += 1) {
    for (const rule of COMMAND_RULES) {
      if (matchesAt(tokens, lead, rule.phrase)) return { rule, lead }
    }
  }
  return null
}

/**
 * Turns one transcript into one intent. One utterance is one command: a
 * sentence holding two of them parses as the first.
 */
export function parseVoiceCommand(transcript: string, options: ParseVoiceCommandOptions = {}): VoiceIntent {
  const kindWords = options.kindWords ?? DEFAULT_KIND_WORDS
  const tokens = normalizeUtterance(transcript, options.wakeWords ?? [])

  const opening = tokens[0]
  if (opening !== undefined && (INTERROGATIVES.has(opening) || REFUSED_OPENERS.has(opening))) {
    return unknownIntent(transcript)
  }

  const match = findRule(tokens)
  if (match === null) return unknownIntent(transcript)

  const { rule, lead } = match
  let rest = tokens.slice(lead + rule.phrase.length)
  let durationMinutes = 0
  let assumedUnit = false

  if (rule.needsDuration) {
    const duration = findSpokenDuration(rest)
    // "Log time for my deen goal" is an unfinished sentence, not a request to
    // start a timer. Guessing which one was meant is how a voice interface
    // loses trust.
    if (duration === null) return unknownIntent(transcript)
    durationMinutes = duration.minutes
    assumedUnit = duration.assumedUnit
    rest = [...rest.slice(0, duration.start), ...rest.slice(duration.end)]
  } else if (isTimeQualifierOnly(rest)) {
    rest = []
  }

  const target = extractTarget(rest, kindWords)

  let score = BASE_CONFIDENCE
  if (lead > 0) score -= LEADING_NOISE_PENALTY
  if (rule.weak) score -= WEAK_PHRASE_PENALTY
  if (assumedUnit) score -= ASSUMED_UNIT_PENALTY
  if (lead === 0 && !rule.weak && tokens.length === rule.phrase.length) score += EXACT_PHRASE_BONUS

  const confidence = clampConfidence(score)
  if (confidence < (options.minConfidence ?? 0)) return unknownIntent(transcript, confidence)

  switch (rule.type) {
    case 'START_TRACKING':
      return { type: 'START_TRACKING', target, transcript, confidence }
    case 'STOP_TRACKING':
      return { type: 'STOP_TRACKING', target, transcript, confidence }
    case 'PAUSE':
      return { type: 'PAUSE', target, transcript, confidence }
    case 'RESUME':
      return { type: 'RESUME', target, transcript, confidence }
    case 'LOG_TIME':
      return { type: 'LOG_TIME', target, transcript, confidence, durationMinutes }
  }
}
