// Ported from dw-time-web/src/features/coach/components/coach-proposal-card.tsx
// (the non-React parsing half only — normalizeCoachActionType,
// parseLenientJson, collapseMultiDayBlocks, extractCoachProposals). This
// isn't part of the task's explicit "port the SSE parser" instruction, but
// it's the same category of problem: the Coach emits ```coach-proposal
// fenced JSON blocks inside its streamed prose, and parsing/validating that
// (including the model's habit of using near-miss action names like
// "ADD_SCHEDULE_BLOCK", or emitting JS-style comments/trailing commas in
// "JSON") is business logic, not UI. Web and mobile both need to turn a raw
// assistant message into { cleaned text, proposal cards, still-streaming? }
// identically — duplicating this in the mobile app would be exactly the
// kind of drift the shared package exists to prevent.
//
// The rendering half (CoachProposalCard's JSX, describeAction's
// cache-lookup-driven human-readable summaries) stays in each app, since
// that's tied to each platform's UI kit and query-cache shape.

import {
  COACH_PROPOSAL_ACTION_TYPES,
  type CoachProposalAction,
  type CoachProposalActionType,
  type CoachProposalBlock,
} from '../api/coach'
import { todayKey } from '../scheduling/time'

const VALID_ACTION_TYPES = new Set<string>(COACH_PROPOSAL_ACTION_TYPES)

// Common verbs the model reaches for that aren't the canonical names. Mapping
// them (instead of dropping) means a proposal survives when a model says
// "ADD_SCHEDULE_BLOCK" instead of "CREATE_SCHEDULE_BLOCK".
const ACTION_TYPE_SYNONYMS: Record<string, CoachProposalActionType> = {
  ADD_GOAL: 'CREATE_GOAL',
  NEW_GOAL: 'CREATE_GOAL',
  EDIT_GOAL: 'UPDATE_GOAL',
  MODIFY_GOAL: 'UPDATE_GOAL',
  REMOVE_GOAL: 'DELETE_GOAL',
  ADD_SCHEDULE_BLOCK: 'CREATE_SCHEDULE_BLOCK',
  NEW_SCHEDULE_BLOCK: 'CREATE_SCHEDULE_BLOCK',
  ADD_BLOCK: 'CREATE_SCHEDULE_BLOCK',
  EDIT_SCHEDULE_BLOCK: 'UPDATE_SCHEDULE_BLOCK',
  MODIFY_SCHEDULE_BLOCK: 'UPDATE_SCHEDULE_BLOCK',
  MOVE_SCHEDULE_BLOCK: 'UPDATE_SCHEDULE_BLOCK',
  UPDATE_BLOCK: 'UPDATE_SCHEDULE_BLOCK',
  REMOVE_SCHEDULE_BLOCK: 'DELETE_SCHEDULE_BLOCK',
  DELETE_BLOCK: 'DELETE_SCHEDULE_BLOCK',
  REMOVE_BLOCK: 'DELETE_SCHEDULE_BLOCK',
  ADD_TASK: 'CREATE_TASK',
  EDIT_TASK: 'UPDATE_TASK',
  REMOVE_TASK: 'DELETE_TASK',
  ADD_TIME_ENTRY: 'CREATE_TIME_ENTRY',
  EDIT_TIME_ENTRY: 'UPDATE_TIME_ENTRY',
  REMOVE_TIME_ENTRY: 'DELETE_TIME_ENTRY',
  ADD_PRACTICE: 'CREATE_PRACTICE',
  NEW_PRACTICE: 'CREATE_PRACTICE',
  // The live stopwatch is the one action users reach for by voice ("start
  // tracking my deen goal"), and dictated phrasing drifts further from the
  // canonical name than typed phrasing does. An unmapped type is dropped
  // silently, so the near-misses are worth spelling out.
  START_TRACKING: 'START_TIMER',
  BEGIN_TIMER: 'START_TIMER',
  TRACK_TIME: 'START_TIMER',
  STOP_TRACKING: 'STOP_TIMER',
  END_TIMER: 'STOP_TIMER',
  // The journal action is append-only, so every verb the model reaches for —
  // create, add, update, write — maps onto the same canonical type. Mapping
  // UPDATE_/SET_ here is deliberate and safe in one direction only: the
  // executor appends, so a model that meant "replace today's entry" gets an
  // extra paragraph instead, and nothing the user wrote is lost. The reverse
  // (dropping the action because the model said UPDATE) is what the user
  // spent two rounds reporting as "it still cannot add entries to my
  // journal", so near-misses are spelled out generously here.
  CREATE_JOURNAL_ENTRY: 'APPEND_JOURNAL_ENTRY',
  ADD_JOURNAL_ENTRY: 'APPEND_JOURNAL_ENTRY',
  UPDATE_JOURNAL_ENTRY: 'APPEND_JOURNAL_ENTRY',
  APPEND_JOURNAL: 'APPEND_JOURNAL_ENTRY',
  ADD_JOURNAL: 'APPEND_JOURNAL_ENTRY',
  WRITE_JOURNAL: 'APPEND_JOURNAL_ENTRY',
  JOURNAL_ENTRY: 'APPEND_JOURNAL_ENTRY',
  // Same append-only reasoning as the journal synonyms above: every verb the
  // model reaches for maps onto the one canonical, append-only action, since
  // mapping a would-be "replace" onto an append can only ever add a
  // paragraph the user didn't lose, never overwrite one they wrote.
  CREATE_NOTE_CONTENT: 'APPEND_NOTE_CONTENT',
  ADD_NOTE_CONTENT: 'APPEND_NOTE_CONTENT',
  UPDATE_NOTE_CONTENT: 'APPEND_NOTE_CONTENT',
  APPEND_NOTE: 'APPEND_NOTE_CONTENT',
  ADD_NOTE: 'APPEND_NOTE_CONTENT',
  ADD_TO_NOTE: 'APPEND_NOTE_CONTENT',
  WRITE_NOTE: 'APPEND_NOTE_CONTENT',
  APPEND_PAGE: 'APPEND_NOTE_CONTENT',
  ADD_PAGE_CONTENT: 'APPEND_NOTE_CONTENT',
  UPDATE_PAGE: 'APPEND_NOTE_CONTENT',
  // Every one of these was verified to be dropped (and therefore to produce a
  // card-less "Something went wrong preparing that change") before being
  // listed here. CREATE_NOTE/NEW_NOTE/CREATE_PAGE are safe to fold onto the
  // append action for the same reason as the UPDATE_ verbs above: the
  // executor is append-only and fails loudly when no page matches, so it can
  // never silently create a page the user did not ask for.
  APPEND_TO_NOTE: 'APPEND_NOTE_CONTENT',
  ADD_TO_NOTES: 'APPEND_NOTE_CONTENT',
  APPEND_NOTES: 'APPEND_NOTE_CONTENT',
  ADD_NOTES: 'APPEND_NOTE_CONTENT',
  CREATE_NOTE: 'APPEND_NOTE_CONTENT',
  NEW_NOTE: 'APPEND_NOTE_CONTENT',
  CREATE_PAGE: 'APPEND_NOTE_CONTENT',
  APPEND_NOTE_ENTRY: 'APPEND_NOTE_CONTENT',
}

/**
 * Coerce a model-emitted action type to a canonical one, or null if it can't
 * be mapped. Dropping the unmappable ones is what keeps a single bad type
 * from 400-ing the entire apply batch on the server.
 */
export function normalizeCoachActionType(raw: unknown): CoachProposalActionType | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toUpperCase()
  if (VALID_ACTION_TYPES.has(key)) return key as CoachProposalActionType
  if (key in ACTION_TYPE_SYNONYMS) return ACTION_TYPE_SYNONYMS[key] ?? null
  return null
}

// LLMs (GPT especially) often emit "JSON" with // or /* */ comments and
// trailing commas — both illegal, so JSON.parse throws and the whole
// proposal silently vanishes, leaving the user with prose and no approval
// card. Strip those tolerantly before parsing. String-aware, so "https://"
// and apostrophes inside string values are never touched.
function stripCommentsAndTrailingCommas(text: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && n === '/') {
      i += 2
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += c
  }
  // Drop trailing commas before a closing } or ].
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// Curly quotes. Models that have been writing prose immediately above the
// fence sometimes carry the typographic quotes straight into the JSON, where
// they are illegal. Only ever applied on the repair retry (see
// parseLenientJson), so a valid block's apostrophes are never rewritten.
function normalizeSmartQuotes(text: string): string {
  return text.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛]/g, "'")
}

/**
 * Escape double quotes the model left unescaped INSIDE a JSON string value —
 * the single most likely way a real proposal dies, because the assistant's
 * own prose quotes the user's words ("I'll append "customise" to ...") and it
 * repeats that habit inside `summary`.
 *
 * Heuristic, and deliberately a conservative one: an unescaped `"` is treated
 * as closing the string only when the next non-whitespace character is one of
 * `: , } ]` or the end of input — the only places a string can legally end in
 * JSON. Anything else means the model is quoting mid-sentence, so the quote
 * gets escaped instead.
 *
 * KNOWN LIMIT, stated rather than papered over: `"He said "hi", then left"`
 * is genuinely undecidable — the `"` before the comma is indistinguishable
 * from a real terminator, and this will (wrongly) treat it as one. No repair
 * can win that case, which is exactly why extractCoachProposals reports a
 * specific `bad-json` failure and the UI offers a retry rather than pretending
 * every block is recoverable.
 *
 * Raw control characters inside strings (a literal newline/tab, also illegal
 * in JSON) are escaped in the same pass.
 */
function escapeStrayQuotes(text: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (!inStr) {
      out += c
      if (c === '"') inStr = true
      continue
    }
    if (esc) {
      out += c
      esc = false
      continue
    }
    if (c === '\\') {
      out += c
      esc = true
      continue
    }
    if (c === '\n') {
      out += '\\n'
      continue
    }
    if (c === '\r') {
      out += '\\r'
      continue
    }
    if (c === '\t') {
      out += '\\t'
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] as string)) j++
      const next = j < text.length ? (text[j] as string) : ''
      if (next === '' || next === ':' || next === ',' || next === '}' || next === ']') {
        out += c
        inStr = false
      } else {
        out += '\\"'
      }
      continue
    }
    out += c
  }
  return out
}

/**
 * Parse the fence body, tolerating the ways models mangle JSON.
 *
 * Two passes, and the order matters: the first is the long-standing
 * comment/trailing-comma strip and NOTHING else, so valid JSON is byte-for-byte
 * untouched by the repair heuristics. Only when that throws do the lossy
 * repairs run. Throws (with the second pass's error) when even the repaired
 * text is unparseable — the caller records that message.
 */
function parseLenientJson(text: string): unknown {
  try {
    return JSON.parse(stripCommentsAndTrailingCommas(text))
  } catch {
    // fall through to the repair pass
  }
  return JSON.parse(stripCommentsAndTrailingCommas(escapeStrayQuotes(normalizeSmartQuotes(text))))
}

/**
 * Pull the action list out of whatever envelope the model reached for.
 * Returns null when there is no action list at all (as distinct from an empty
 * one, which is a different failure the user gets told about differently).
 *
 * `{"action": {...}}` (singular) and `{"actions": {...}}` (a bare object
 * rather than an array) were both verified to produce a card-less failure
 * before being accepted here.
 */
function readActionsEnvelope(parsed: unknown): unknown[] | null {
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  for (const key of ['actions', 'action'] as const) {
    const value = record[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') return [value]
  }
  return null
}

function describeRejectedType(action: Record<string, unknown>): string {
  const raw = action.type
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (raw === undefined) return '(no type)'
  return String(raw)
}

// Collapse identical single-day CREATE_SCHEDULE_BLOCK actions (same title,
// time, category, goal) into one multi-day action carrying daysOfWeek. The
// model is asked to do this itself, but often emits one action per day
// anyway — a full week is then ~90+ actions, over the apply cap. Doing it
// here guarantees a week stays compact regardless of what the model emits.
function collapseMultiDayBlocks(actions: CoachProposalAction[]): CoachProposalAction[] {
  const keyOf = (p: Record<string, unknown>) =>
    [p.title, p.startTime, p.endTime, p.category ?? '', p.goalId ?? ''].join('|')
  const isSingleDayBlock = (a: CoachProposalAction) => {
    const p = (a.payload ?? {}) as Record<string, unknown>
    return a.type === 'CREATE_SCHEDULE_BLOCK' && typeof p.dayOfWeek === 'number' && !Array.isArray(p.daysOfWeek)
  }

  const daysByKey = new Map<string, number[]>()
  for (const a of actions) {
    if (!isSingleDayBlock(a)) continue
    const p = a.payload as Record<string, unknown>
    const k = keyOf(p)
    const arr = daysByKey.get(k) ?? []
    arr.push(p.dayOfWeek as number)
    daysByKey.set(k, arr)
  }

  const emitted = new Set<string>()
  const out: CoachProposalAction[] = []
  for (const a of actions) {
    if (!isSingleDayBlock(a)) {
      out.push(a)
      continue
    }
    const p = a.payload as Record<string, unknown>
    const k = keyOf(p)
    if (emitted.has(k)) continue // a later duplicate folded into the group
    emitted.add(k)
    const days = Array.from(new Set(daysByKey.get(k) ?? [])).sort((x, y) => x - y)
    if (days.length > 1) {
      const { dayOfWeek: _drop, ...rest } = p
      out.push({ ...a, payload: { ...rest, daysOfWeek: days } })
    } else {
      out.push(a)
    }
  }
  return out
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Stamp the DEVICE's local day onto any APPEND_JOURNAL_ENTRY that didn't name
 * one, so the Coach writes to the same entry the Journal tab and the
 * microphone button consider "today".
 *
 * This is not belt-and-braces — it decides which day gets written. The model
 * is told to omit `date` for today (it is not reliably given today's date in
 * its context, so a guess would be worse), and the API's own fallback is
 * `new Date().toISOString().slice(0, 10)`, i.e. UTC. For a user far enough
 * east or west that is a different calendar day from the one their Journal
 * tab is showing, and "the Coach said it added it, but my journal is empty"
 * is precisely the complaint this whole feature exists to fix. `todayKey()`
 * is the same local-day function journal.tsx and voice.tsx both use.
 *
 * A `date` the model DID send is left exactly as it is (that is the user
 * naming a specific past day), and so is a malformed one — the server
 * validates the format and failing the action loudly beats quietly
 * rewriting the user's intent to "today".
 */
function fillJournalDates(actions: CoachProposalAction[]): CoachProposalAction[] {
  return actions.map((action) => {
    if (action.type !== 'APPEND_JOURNAL_ENTRY') return action
    const payload = (action.payload ?? {}) as Record<string, unknown>
    const date = payload.date
    if (typeof date === 'string' && ISO_DATE.test(date.trim())) return action
    if (date !== undefined && date !== null && date !== '') return action
    return { ...action, payload: { ...payload, date: todayKey() } }
  })
}

/**
 * WHY this is a discriminated union and not a boolean.
 *
 * It used to be `unrenderable: boolean`, and all four of the ways a closed
 * ```coach-proposal block can yield nothing collapsed into it — including a
 * `catch {}` that threw the parse error away entirely. Every one of them
 * reached the user as the same sentence: "Something went wrong preparing that
 * change. Try asking again." A real user hit that twice in one session and
 * (correctly) reported it as the app refusing to say what was actually wrong.
 *
 * Keeping the reason means the UI can say something true and specific, and
 * `bad-json.raw` means the NEXT occurrence is diagnosable from a log line
 * instead of from screenshots.
 */
export type CoachProposalFailure =
  /** The fence body was not JSON, even after the repair pass. `detail` is the
   *  JSON.parse message; `raw` is the (truncated) block, for diagnostics only
   *  — never render it. */
  | { reason: 'bad-json'; detail: string; raw: string }
  /** Parsed fine, but carried no `actions`/`action` field at all. */
  | { reason: 'no-actions' }
  /** Parsed fine and had an actions list, but it was empty. */
  | { reason: 'empty-actions' }
  /** Every action's `type` failed to normalize. `types` holds the raw strings
   *  the model emitted, so the message can name them. */
  | { reason: 'unknown-types'; types: string[] }

/**
 * The one place the user-facing sentence for each failure is written, so it
 * is unit-testable and cannot quietly regress to a generic "something went
 * wrong" again.
 *
 * Every string ends with "Nothing was changed." — which is always true here:
 * this whole code path runs on the model's text before any apply call exists,
 * so no write has been attempted, let alone made. That reassurance is
 * precisely what the old sentence left the user to guess at.
 */
export function describeCoachProposalFailure(failure: CoachProposalFailure): string {
  switch (failure.reason) {
    case 'unknown-types': {
      const named = failure.types.filter((t) => t && t !== '(no type)')
      if (named.length) {
        return `The Coach proposed "${named.join('", "')}", which this version of the app can't apply. Nothing was changed.`
      }
      return "The Coach's change didn't name an action this app recognises. Nothing was changed."
    }
    case 'bad-json':
      return "The Coach's change didn't arrive in a form the app could read, so there's nothing to approve. Nothing was changed."
    case 'no-actions':
    case 'empty-actions':
      return "The Coach said it prepared a change but didn't include one. Nothing was changed."
  }
}

export interface ExtractedCoachProposals {
  /** The assistant's message text with all ```coach-proposal blocks removed. */
  cleaned: string
  /** Fully parsed, validated proposal blocks ready to render as cards. */
  proposals: CoachProposalBlock[]
  /** True while a coach-proposal block is still being streamed in (not yet closed by a trailing ```). */
  pending: boolean
  /**
   * Non-null when a fully-closed ```coach-proposal block was present but
   * produced zero renderable proposals — carrying WHICH of the four ways it
   * failed (see CoachProposalFailure).
   *
   * Without this, that case is indistinguishable from "no proposal was ever
   * intended": the block is stripped from `cleaned` either way, so the
   * assistant's prose can say "Here's the proposal:" while nothing renders
   * for the user to review or apply. Callers must surface
   * `describeCoachProposalFailure(...)` as a visible inline notice — never a
   * silent no-op, and never a generic one.
   */
  unrenderable: CoachProposalFailure | null
}

/**
 * Extracts ```coach-proposal fenced blocks from raw assistant content.
 * Returns the cleaned content (with blocks removed) plus parsed blocks.
 *
 * Handles three streaming states:
 *  - closed block (```coach-proposal ... ```)        parsed into proposals, stripped from cleaned text
 *  - open block at end (model still streaming JSON)   stripped from cleaned text, `pending` flagged so UI shows a placeholder
 *  - opening fence partially typed (e.g. "```coach")   trimmed off the tail so the user never sees raw fence/JSON
 */
export function extractCoachProposals(raw: string): ExtractedCoachProposals {
  if (!raw) return { cleaned: raw, proposals: [], pending: false, unrenderable: null }

  const proposals: CoachProposalBlock[] = []
  // Set when a closed block existed but yielded nothing renderable — see the
  // `unrenderable` field doc on ExtractedCoachProposals for why this is
  // tracked separately from "no block was ever present", and why it carries a
  // reason rather than being a boolean.
  let unrenderable: CoachProposalFailure | null = null

  // 1. Pull out any fully-closed blocks.
  const closed = /```coach-proposal\s*\n([\s\S]*?)```/g
  let cleaned = raw.replace(closed, (_m, jsonText: string) => {
    try {
      const parsed = parseLenientJson(jsonText.trim())
      const summary = (parsed as { summary?: unknown } | null)?.summary
      const rawActions = readActionsEnvelope(parsed)
      if (rawActions === null) {
        // Parsed as JSON, but there is no action list under any envelope the
        // model might have reached for.
        unrenderable = { reason: 'no-actions' }
        return ''
      }
      if (rawActions.length === 0) {
        unrenderable = { reason: 'empty-actions' }
        return ''
      }
      // Normalize + validate types here so a hallucinated action (e.g.
      // "ADD_SCHEDULE_BLOCK") is either remapped or dropped, rather than
      // sent on to /apply where one bad type 400s the whole batch. The
      // rejected names are kept so a total failure can name them.
      const rejectedTypes: string[] = []
      const normalized = rawActions
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => {
          const type = normalizeCoachActionType(a.type)
          if (!type) {
            rejectedTypes.push(describeRejectedType(a))
            return null
          }
          return { ...a, type } as CoachProposalAction
        })
        .filter((a): a is CoachProposalAction => a !== null)
      // Fold per-day repeats into compact multi-day actions so a full week
      // fits under the apply cap even when the model emits one block per day,
      // then pin any dateless journal append to the device's local day.
      const actions = fillJournalDates(collapseMultiDayBlocks(normalized))
      if (actions.length) {
        proposals.push({
          summary: typeof summary === 'string' ? summary : undefined,
          actions,
        })
      } else {
        // Every action in the block failed to normalize (e.g. all of them
        // were an unknown type like "ARCHIVE_GOAL"). The model believed it
        // emitted a real proposal; the user must be told nothing came of it,
        // and told WHICH type the app couldn't apply.
        unrenderable = { reason: 'unknown-types', types: rejectedTypes }
      }
    } catch (err) {
      // Malformed/non-JSON content inside the fence, even after the repair
      // pass. The error message and the offending block are kept rather than
      // discarded: this used to be a bare `catch {}`, which is exactly why the
      // real cause of a live user-visible failure could not be recovered.
      unrenderable = {
        reason: 'bad-json',
        detail: err instanceof Error ? err.message : String(err),
        raw: jsonText.trim().slice(0, 2000),
      }
    }
    return ''
  })

  // 2. Strip an open (unclosed) coach-proposal block at the tail of the stream.
  let pending = false
  const openIdx = cleaned.indexOf('```coach-proposal')
  if (openIdx !== -1) {
    cleaned = cleaned.slice(0, openIdx)
    pending = true
  } else {
    // 3. Strip a partially-typed opening fence like "``", "```", "```c",
    //    "```coach", etc. Only trim if it's at the very end of the buffer so
    //    real backticks elsewhere in the message are never eaten.
    const partial = cleaned.match(/```[a-z-]{0,15}$/i)
    if (partial) {
      const idx = cleaned.lastIndexOf(partial[0])
      if (idx !== -1) {
        cleaned = cleaned.slice(0, idx)
        pending = true
      }
    }
  }

  return { cleaned: cleaned.trim(), proposals, pending, unrenderable }
}
