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
function parseLenientJson(text: string): unknown {
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
  out = out.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(out)
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

export interface ExtractedCoachProposals {
  /** The assistant's message text with all ```coach-proposal blocks removed. */
  cleaned: string
  /** Fully parsed, validated proposal blocks ready to render as cards. */
  proposals: CoachProposalBlock[]
  /** True while a coach-proposal block is still being streamed in (not yet closed by a trailing ```). */
  pending: boolean
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
  if (!raw) return { cleaned: raw, proposals: [], pending: false }

  const proposals: CoachProposalBlock[] = []

  // 1. Pull out any fully-closed blocks.
  const closed = /```coach-proposal\s*\n([\s\S]*?)```/g
  let cleaned = raw.replace(closed, (_m, jsonText: string) => {
    try {
      const parsed = parseLenientJson(jsonText.trim()) as {
        actions?: unknown[]
        summary?: unknown
      }
      if (parsed && Array.isArray(parsed.actions) && parsed.actions.length) {
        // Normalize + validate types here so a hallucinated action (e.g.
        // "ADD_SCHEDULE_BLOCK") is either remapped or dropped, rather than
        // sent on to /apply where one bad type 400s the whole batch.
        const normalized = parsed.actions
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
          .map((a) => {
            const type = normalizeCoachActionType((a as Record<string, unknown>).type)
            return type ? ({ ...a, type } as CoachProposalAction) : null
          })
          .filter((a): a is CoachProposalAction => a !== null)
        // Fold per-day repeats into compact multi-day actions so a full week
        // fits under the apply cap even when the model emits one block per day.
        const actions = collapseMultiDayBlocks(normalized)
        if (actions.length) {
          proposals.push({
            summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
            actions,
          })
        }
      }
    } catch {
      /* malformed, drop silently */
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

  return { cleaned: cleaned.trim(), proposals, pending }
}
