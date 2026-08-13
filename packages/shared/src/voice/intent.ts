// Domain types for spoken time-tracking commands.
//
// WHY THESE SHAPES: they are `jiffy-voice`'s public contract
// (github.com/ZeeshanAdilButt/jiffy-voice — `VoiceIntent`, `NamedTarget`,
// `ResolvedTarget`, `TargetCandidate`), reproduced here name-for-name and
// semantics-for-semantics. That package is the intended long-term home for
// this parsing: it is the same code, tested far harder, and shared with
// whatever else the product grows. It is not a dependency yet for one
// mechanical reason — it is unpublished (no registry entry) and its `dist/`
// is gitignored, so neither `pnpm add jiffy-voice` nor a git dependency
// resolves to anything importable in CI.
//
// So this module is a stand-in sized to what the mobile Time Tracker
// actually needs, written against the same contract on purpose: when
// jiffy-voice ships to a registry, `src/voice/index.ts` becomes a re-export
// and nothing that imports from `@goalslot/shared` changes. Do not let the
// two drift — if a shape has to change here, it is a signal the contract
// needs changing there.
//
// One deliberate narrowing: `ResolvedTarget.kind` keeps jiffy-voice's full
// 'goal' | 'task' | 'category' set even though the mobile timer only ever
// supplies goals and tasks (see apps/mobile/src/lib/timer-store.ts, which
// stores exactly `taskId` and `goalId`). Dropping 'category' would make the
// eventual swap a breaking change for the sake of three characters.

export const VOICE_INTENT_TYPES = [
  'START_TRACKING',
  'STOP_TRACKING',
  'PAUSE',
  'RESUME',
  'LOG_TIME',
  'APPEND_NOTE',
  'UNKNOWN',
] as const

export type VoiceIntentType = (typeof VOICE_INTENT_TYPES)[number]

export const TARGET_KINDS = ['goal', 'task', 'category', 'note'] as const

/** What a spoken name refers to, in the host's broad buckets. */
export type TargetKind = (typeof TARGET_KINDS)[number]

/**
 * A speaker can name something without saying what type it is ("start
 * tracking deen"). Guessing the kind there would be inventing knowledge the
 * parser does not have, so it says so and the resolver searches everything.
 */
export type SpokenTargetKind = TargetKind | 'unspecified'

export interface NoTarget {
  readonly kind: 'none'
}

export interface NamedTarget {
  readonly kind: SpokenTargetKind
  readonly name: string
}

export type IntentTarget = NoTarget | NamedTarget

export const NO_TARGET: NoTarget = Object.freeze({ kind: 'none' })

export function namedTarget(kind: SpokenTargetKind, name: string): NamedTarget {
  return Object.freeze({ kind, name: name.trim().replace(/\s+/g, ' ') })
}

export function isNamedTarget(target: IntentTarget): target is NamedTarget {
  return target.kind !== 'none'
}

interface IntentFields {
  /** The transcript exactly as it arrived, before any normalization. */
  readonly transcript: string
  /** How sure the parser is, from 0 to 1. */
  readonly confidence: number
}

export interface StartTrackingIntent extends IntentFields {
  readonly type: 'START_TRACKING'
  readonly target: IntentTarget
}

export interface StopTrackingIntent extends IntentFields {
  readonly type: 'STOP_TRACKING'
  readonly target: IntentTarget
}

export interface PauseIntent extends IntentFields {
  readonly type: 'PAUSE'
  readonly target: IntentTarget
}

export interface ResumeIntent extends IntentFields {
  readonly type: 'RESUME'
  readonly target: IntentTarget
}

export interface LogTimeIntent extends IntentFields {
  readonly type: 'LOG_TIME'
  readonly target: IntentTarget
  /** May be fractional, so "log 45 seconds" survives the trip. */
  readonly durationMinutes: number
}

/**
 * "Add this to my shopping notes" — writes a spoken sentence onto the end of
 * an existing page rather than replacing anything on it. Deliberately NOT in
 * `isReversibleVoiceIntent`'s set: like LOG_TIME, this appends unreviewed
 * spoken text to a record that outlives the session, so it confirms first
 * instead of running the instant it is heard. See
 * apps/mobile/src/components/voice/note-commands.ts.
 */
export interface AppendNoteIntent extends IntentFields {
  readonly type: 'APPEND_NOTE'
  readonly target: IntentTarget
  /**
   * The words to write into the page, exactly as heard. Unlike every other
   * field on every other intent here, this is NOT folded — it is written
   * into the note close to verbatim, so the casing and punctuation the
   * speaker actually used survive the trip.
   */
  readonly content: string
}

/**
 * The parser understood nothing it is willing to act on. Carries no target
 * field at all (rather than a `none` target) so a caller cannot read a
 * target off an intent that has no meaning without narrowing first.
 */
export interface UnknownIntent extends IntentFields {
  readonly type: 'UNKNOWN'
}

export type ActionableVoiceIntent =
  | StartTrackingIntent
  | StopTrackingIntent
  | PauseIntent
  | ResumeIntent
  | LogTimeIntent
  | AppendNoteIntent

export type VoiceIntent = ActionableVoiceIntent | UnknownIntent

/**
 * Confidence is compared against thresholds by every caller, so a value
 * outside 0..1 or a NaN leaking out would silently break those comparisons
 * rather than fail. Rounding keeps scores stable enough to assert on.
 */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  const bounded = Math.min(1, Math.max(0, value))
  return Math.round(bounded * 100) / 100
}

export function unknownIntent(transcript: string, confidence = 0): UnknownIntent {
  return { type: 'UNKNOWN', transcript, confidence: clampConfidence(confidence) }
}

export function isActionableVoiceIntent(intent: VoiceIntent): intent is ActionableVoiceIntent {
  return intent.type !== 'UNKNOWN'
}

/**
 * The four transport intents. Named as a set because the whole confirmation
 * policy hangs off it: these change nothing a user cannot undo by speaking
 * the opposite word, so they run immediately, while LOG_TIME writes a record
 * and does not. See apps/mobile/src/components/voice/TrackerVoiceButton.tsx.
 */
export function isReversibleVoiceIntent(intent: VoiceIntent): boolean {
  return (
    intent.type === 'START_TRACKING' ||
    intent.type === 'STOP_TRACKING' ||
    intent.type === 'PAUSE' ||
    intent.type === 'RESUME'
  )
}

const INTENT_VERBS: Record<Exclude<VoiceIntentType, 'UNKNOWN'>, string> = {
  START_TRACKING: 'Start tracking',
  STOP_TRACKING: 'Stop tracking',
  PAUSE: 'Pause',
  RESUME: 'Resume',
  LOG_TIME: 'Log',
  APPEND_NOTE: 'Add to',
}

/** Whole minutes read as "1h 30m"; anything under a minute stays in seconds. */
export function formatSpokenDuration(minutes: number): string {
  if (minutes < 1) {
    const seconds = Math.round(minutes * 60)
    return `${seconds} sec`
  }
  const whole = Math.round(minutes)
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

/**
 * One line for a confirmation prompt or a screen-reader announcement. The
 * voice UI shows this before acting on something it only heard once.
 */
export function describeVoiceIntent(intent: VoiceIntent, resolvedName?: string): string {
  if (!isActionableVoiceIntent(intent)) return 'Unknown command'

  const verb = INTENT_VERBS[intent.type]
  const duration = intent.type === 'LOG_TIME' ? ` ${formatSpokenDuration(intent.durationMinutes)}` : ''
  const preposition = intent.type === 'LOG_TIME' ? ' to ' : ' '
  const name = resolvedName ?? (isNamedTarget(intent.target) ? intent.target.name : null)

  return name === null ? `${verb}${duration}` : `${verb}${duration}${preposition}${name}`
}
