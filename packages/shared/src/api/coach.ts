// Ported from dw-time-web/src/lib/api.ts's Coach section (roughly lines
// 430-900): CoachMessageDto, CoachStreamChunk, the proposal action types +
// COACH_PROPOSAL_ACTION_TYPES runtime guard, parseCoachSseStream, and
// postCoachStream. The REST endpoints (history/clear/apply) follow this
// package's createXApi(api) factory pattern (see ./goals.ts) since axios
// handles them fine. Streaming does NOT go through axios — axios in React
// Native has no way to read a response body incrementally, so the SSE
// helpers below are plain fetch-based functions instead, generic over
// "some fetch-like function that returns a Response with a readable body".
// Web hands in the browser's global `fetch`; the mobile app hands in
// `expo/fetch`'s fetch, which is backed by native networking (OkHttp /
// NSURLSession) and — unlike Hermes' built-in `fetch` — actually supports
// reading `response.body` as a ReadableStream. See apps/mobile's
// src/lib/api-client.ts for that wiring and the verification notes.
//
// Only the chat + proposal-apply surface is ported here for the mobile
// Coach screen's first pass. BYOK, habits profile, check-ins, journal-via-
// coach, insights, and narrative endpoints exist on the API (see
// dw-time-api/src/modules/coach-ai/coach-ai.controller.ts and the sibling
// coach-insights/coach-checkin/coach-proposals modules) but have no mobile
// UI yet — deliberately out of scope for this pass, not an oversight.

import type { AxiosInstance } from 'axios'

import { getISOWeekKey } from '../scheduling/time'

export type CoachMessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM_NARRATIVE'

export interface CoachMessageDto {
  id: string
  scopeKey: string
  role: CoachMessageRole
  content: string
  promptTokens?: number | null
  completionTokens?: number | null
  model?: string | null
  createdAt: string
}

/** One `data: {...}` SSE frame from a NestJS @Sse() coach endpoint. */
export interface CoachStreamChunk {
  delta: string
  done: boolean
  usage?: { promptTokens: number; completionTokens: number }
  error?: string
}

export type CoachProposalActionType =
  | 'RENAME_GOAL'
  | 'UPDATE_GOAL'
  | 'CREATE_GOAL'
  | 'DELETE_GOAL'
  | 'CREATE_SCHEDULE_BLOCK'
  | 'UPDATE_SCHEDULE_BLOCK'
  | 'DELETE_SCHEDULE_BLOCK'
  | 'CREATE_TIME_ENTRY'
  | 'UPDATE_TIME_ENTRY'
  | 'DELETE_TIME_ENTRY'
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'DELETE_TASK'
  | 'CREATE_PRACTICE'
  // Live stopwatch, NOT interchangeable with CREATE_TIME_ENTRY:
  // CREATE_TIME_ENTRY logs work that already finished and whose duration is
  // known, whereas START_TIMER/STOP_TIMER drive the shared ActiveTimerSession
  // where the duration isn't known until the user stops.
  | 'START_TIMER'
  | 'STOP_TIMER'
  // Adds a paragraph to a day's journal entry — payload
  // `{ content: string; date?: 'YYYY-MM-DD' }`, no id. APPEND-ONLY: the
  // backend joins `content` onto whatever the entry already holds rather
  // than replacing it, matching the voice fast-path's APPEND_JOURNAL intent
  // (see ../voice/intent.ts and apps/mobile's voice.tsx) so a line dictated
  // into the microphone and a line the Coach adds from chat are
  // indistinguishable once they land. `date` is normally filled in by
  // extractCoachProposals from the DEVICE's local day — see
  // ../coach/proposals.ts — because the server's own fallback is UTC.
  | 'APPEND_JOURNAL_ENTRY'
  // Adds a paragraph to an EXISTING note/page — payload
  // `{ titleHint: string; content: string }`, no id at all: unlike every
  // other action type, the Coach is never given the user's note titles/ids
  // in its chat context, so `titleHint` is whatever the user called the
  // page and the backend resolves it against the user's own notes (exact
  // title match preferred, substring fallback — see goal-slot-api's
  // NotesService.appendContentByTitleHint / note-content.ts). APPEND-ONLY,
  // same contract as APPEND_JOURNAL_ENTRY: never replaces the page's
  // existing content. An ambiguous or absent title match fails the action
  // with an explanatory message rather than guessing or creating a new page
  // — that message is what CoachProposalResult.error carries back.
  | 'APPEND_NOTE_CONTENT'

/**
 * Runtime source-of-truth for the action types the API accepts (mirrors
 * dw-time-api's COACH_ACTION_TYPES in
 * coach-proposals/dto/apply-proposals.dto.ts). Used to validate/normalize
 * proposals the model emits before they're ever shown or applied.
 *
 * This array and the union above are separate declarations — adding a type to
 * only one of them fails in a different way each time (type-only vs runtime
 * validation), so always change both. A type the API emits but this array
 * omits is dropped by normalizeCoachActionType before the user ever sees it.
 */
export const COACH_PROPOSAL_ACTION_TYPES: readonly CoachProposalActionType[] = [
  'RENAME_GOAL',
  'UPDATE_GOAL',
  'CREATE_GOAL',
  'DELETE_GOAL',
  'CREATE_SCHEDULE_BLOCK',
  'UPDATE_SCHEDULE_BLOCK',
  'DELETE_SCHEDULE_BLOCK',
  'CREATE_TIME_ENTRY',
  'UPDATE_TIME_ENTRY',
  'DELETE_TIME_ENTRY',
  'CREATE_TASK',
  'UPDATE_TASK',
  'DELETE_TASK',
  'CREATE_PRACTICE',
  'START_TIMER',
  'STOP_TIMER',
  'APPEND_JOURNAL_ENTRY',
  'APPEND_NOTE_CONTENT',
]

export interface CoachProposalAction {
  type: CoachProposalActionType
  id?: string
  payload?: Record<string, unknown>
  /**
   * For UPDATE_SCHEDULE_BLOCK/DELETE_SCHEDULE_BLOCK: the block's title as the
   * Coach currently believes it to be, BEFORE this action's changes are
   * applied — mirrors `expectedTitle` on the API's `CoachProposedAction` DTO
   * (goal-slot-api/src/modules/coach-proposals/dto/apply-proposals.dto.ts).
   * The backend requires the model to set this whenever the user identified
   * the target block by name, purely as an identity check; the UI reuses it
   * to describe an id-only action (e.g. "move it 30 minutes later") without
   * a raw id or a cache lookup that might miss.
   */
  expectedTitle?: string
}

export interface CoachProposalResult {
  index: number
  type: CoachProposalActionType
  ok: boolean
  resultId?: string
  error?: string
}

export interface CoachProposalBlock {
  summary?: string
  actions: CoachProposalAction[]
}

interface CoachChatHistoryEnvelope {
  messages?: CoachMessageDto[]
}

// ---------------------------------------------------------------------------
// POST /coach/voice-intent — the fast, non-streaming Tier 2 classifier that
// sits between the local, zero-network `parseVoiceCommand` (Tier 1, see
// ../voice/parse.ts) and the full Coach chat turn (Tier 3, `streamChat`
// above). Tier 1 only recognises a fixed, narrow set of phrasings; anything
// it can't confidently place is handed to this endpoint instead of going
// straight to the LLM chat pipeline, on the theory that classifying intent
// is a much smaller (and much faster/cheaper) job than holding a whole
// conversation. See apps/mobile/app/(app)/voice.tsx for the caller.
// ---------------------------------------------------------------------------

/**
 * What the endpoint can classify a transcript as. Deliberately a wider set
 * than Tier 1's `VoiceIntentType` (../voice/intent.ts): this endpoint also
 * recognises journal, task/goal creation, and day-summary questions that the
 * local rule table never attempts, plus the catch-all CHAT/UNKNOWN that mean
 * "let the full Coach handle this".
 */
export const COACH_VOICE_INTENT_TYPES = [
  'START_TRACKING',
  'STOP_TRACKING',
  'PAUSE',
  'RESUME',
  'APPEND_NOTE',
  'APPEND_JOURNAL',
  'CREATE_TASK',
  'CREATE_GOAL',
  'DAY_QUERY',
  'CHAT',
  'UNKNOWN',
] as const

export type CoachVoiceIntentType = (typeof COACH_VOICE_INTENT_TYPES)[number]

export interface CoachVoiceIntentCandidateGoal {
  id: string
  title: string
}

export interface CoachVoiceIntentCandidateTask {
  id: string
  title: string
  goalId?: string
}

/** What the caller already knows about the timer, so the model doesn't have to guess whether "stop" makes sense right now. */
export type CoachVoiceIntentTimerStatus = 'idle' | 'running' | 'paused'

export interface CoachVoiceIntentContext {
  candidateGoals: readonly CoachVoiceIntentCandidateGoal[]
  candidateTasks: readonly CoachVoiceIntentCandidateTask[]
  timerStatus: CoachVoiceIntentTimerStatus
}

/**
 * The one target shape the endpoint ever resolves to. Deliberately narrower
 * than Tier 1's `TargetKind` (../voice/intent.ts, which also has 'category'
 * and 'note'): the request context above only ever supplies goal/task
 * candidates, so the model has nothing to match a note against and a 'note'
 * kind could never come back populated. A caller that gets APPEND_NOTE back
 * with a null target should treat it exactly like an unresolved local
 * match — hand off rather than guess which page was meant.
 */
export interface CoachVoiceIntentTarget {
  kind: 'goal' | 'task'
  id: string
}

export interface CoachVoiceIntentResponse {
  intent: CoachVoiceIntentType
  /** 'low' means "don't act on this without confirming" — same spirit as Tier 1's confidence score, collapsed to two buckets since this is a classification, not a fuzzy string match. */
  confidence: 'high' | 'low'
  target: CoachVoiceIntentTarget | null
  /** The words to act on — a note/journal paragraph, a task/goal title. Null when the intent carries no text of its own (e.g. STOP_TRACKING). */
  text: string | null
  /** Human-readable, for logs/debugging — never shown to the end user. */
  reasoning: string
}

export function createCoachApi(api: AxiosInstance) {
  return {
    // Backend always wraps this as { messages: CoachMessageDto[] } (see
    // coach-ai.service.ts#getChatHistory), but the array shape is tolerated
    // too — normalize to a plain array at the boundary either way, same as
    // web's coachApi.getChatHistory.
    getChatHistory: async (scopeKey: string) => {
      const res = await api.get<CoachChatHistoryEnvelope | CoachMessageDto[]>(`/coach/chat/${scopeKey}`)
      const raw = res.data
      const messages = Array.isArray(raw) ? raw : raw?.messages ?? []
      return { ...res, data: messages }
    },
    clearChatHistory: (scopeKey: string) => api.delete<{ success: true }>(`/coach/chat/${scopeKey}`),
    // Not called from the mobile UI yet — proposal cards render read-only
    // for this first pass (see apps/mobile's coach screen). Included here
    // so the API surface matches the backend contract and a future "Apply"
    // action doesn't need a new endpoint wired up.
    applyProposals: (actions: CoachProposalAction[], sourceMessageId?: string) =>
      api.post<{ results: CoachProposalResult[] }>('/coach/proposals/apply', {
        actions,
        ...(sourceMessageId ? { sourceMessageId } : {}),
      }),
    // Tier 2 of the voice routing pipeline — see this file's header comment
    // just above CoachVoiceIntentResponse. Plain request/response, not SSE:
    // classification is a single JSON object, not a token stream, so this
    // goes through axios like every other REST call here rather than
    // through postCoachStream's fetch-based machinery.
    voiceIntent: (transcript: string, context: CoachVoiceIntentContext) =>
      api.post<CoachVoiceIntentResponse>('/coach/voice-intent', { transcript, context }),
  }
}

export type CoachApi = ReturnType<typeof createCoachApi>

// ---------------------------------------------------------------------------
// SSE streaming — pure, platform-agnostic (no axios, no React Native/DOM
// runtime dependency beyond the standard fetch/ReadableStream/TextDecoder
// *types*, which every JS platform this monorepo targets implements).
// ---------------------------------------------------------------------------

/**
 * Stream NestJS @Sse() responses framed as `data: {...}\n\n`. Ported
 * verbatim (frame-buffering logic unchanged) from
 * dw-time-web/src/lib/api.ts's parseCoachSseStream. Handles partial frames
 * straddling chunk boundaries by holding an accumulating buffer and only
 * consuming up to the last `\n\n`, and tolerates `\r\n` line endings.
 *
 * Generic over the standard `Response` type rather than anything
 * axios-specific, so both web (`fetch`) and mobile (`expo/fetch`) can hand
 * in whatever their fetch implementation returns.
 */
export async function* parseCoachSseStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<CoachStreamChunk, void, void> {
  if (!response.body) {
    throw new Error('Response has no body to stream')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {})
        return
      }
      let value: Uint8Array | undefined
      let done = false
      try {
        ;({ value, done } = await reader.read())
      } catch (err) {
        // An in-flight read() rejects when the caller aborts the request
        // mid-stream. That's an intentional stop (user hit Stop, or the
        // component unmounted), not a failure, so end the stream quietly
        // instead of letting it bubble up and render as a chat error.
        if (signal?.aborted) return
        throw err
      }
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Parse complete SSE frames separated by a blank line (\n\n).
      const normalized = buffer.replace(/\r\n/g, '\n')
      buffer = ''
      const frames = normalized.split('\n\n')
      // Last element may be a partial frame — push it back into the buffer.
      const tail = frames.pop() ?? ''
      buffer = tail
      for (const frame of frames) {
        const trimmed = frame.trim()
        if (!trimmed) continue
        // A frame may contain multiple lines; concatenate `data:` payloads.
        const dataLines: string[] = []
        for (const line of trimmed.split('\n')) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }
        if (dataLines.length === 0) continue
        const payload = dataLines.join('\n')
        try {
          const parsed = JSON.parse(payload)
          // NestJS @Sse() wraps the payload in { data: ... }; tolerate either shape.
          const inner = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
          yield inner as CoachStreamChunk
        } catch {
          // Ignore malformed frames rather than killing the stream.
        }
      }
    }
    // Flush any leftover trailing data after stream close (rare).
    const final = buffer.trim()
    if (final) {
      const lines = final.split('\n')
      const dataLines: string[] = []
      for (const line of lines) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (dataLines.length) {
        try {
          const parsed = JSON.parse(dataLines.join('\n'))
          const inner = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
          yield inner as CoachStreamChunk
        } catch {
          /* swallow */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* noop */
    }
  }
}

export interface CoachStreamRequestConfig {
  /** Origin only, e.g. "https://api.goalslot.io" — "/api" is appended. */
  baseUrl: string
  /**
   * A fetch-like function. Must return a Response whose `.body` supports
   * `getReader()` (browser fetch and `expo/fetch` both qualify; Hermes'
   * built-in `fetch` on React Native does NOT — see apps/mobile's
   * api-client.ts for why it passes `expo/fetch` explicitly instead of the
   * RN global).
   */
  fetchImpl: typeof fetch
  getAccessToken: () => Promise<string | null>
}

/**
 * POST a Coach SSE endpoint (chat today; narrative would use the same
 * helper) and return the parsed delta stream. Ported from web's
 * postCoachStream, generalized to take its baseUrl/fetch/token dependencies
 * as an explicit config object instead of reading module-level
 * `API_BASE_URL`/`localStorage` — this package has no module-level app
 * config or DOM storage to read.
 */
export async function postCoachStream(
  config: CoachStreamRequestConfig,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<AsyncGenerator<CoachStreamChunk, void, void>> {
  const token = await config.getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await config.fetchImpl(`${config.baseUrl}/api${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.message) message = Array.isArray(data.message) ? data.message.join(', ') : String(data.message)
    } catch {
      /* ignore */
    }
    const err: Error & { status?: number } = new Error(message)
    err.status = res.status
    throw err
  }

  return parseCoachSseStream(res, signal)
}

/**
 * The scopeKey the Coach chat/narrative endpoints use for "the current
 * week" — "YYYY-Www" (ISO week). Ported from web's currentScopeKey('week')
 * in coach-page.tsx; the API's isoWeekRange() parser
 * (coach-ai.service.ts) expects exactly this shape. Only the week period is
 * ported — web also supports month/quarter/year scopes via a period picker,
 * which the mobile chat doesn't expose in this first pass (chat always
 * targets the current week, matching how a phone-sized chat screen has no
 * room for a scope switcher yet).
 *
 * Thin wrapper over `../scheduling/time`'s `getISOWeekKey` — same ISO-week
 * math, kept as its own named export here (rather than every Coach call site
 * importing `getISOWeekKey` directly) because "current scope key" is a
 * Coach-domain concept and the two previously drifted into two copies of the
 * same six-line algorithm before this was consolidated.
 */
export function currentCoachWeekScopeKey(now: Date = new Date()): string {
  return getISOWeekKey(now)
}
