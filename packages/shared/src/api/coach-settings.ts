// The two Coach surfaces that belong to Settings rather than to the Coach
// chat screen: the bring-your-own-key credential (`/coach/byok-key`) and the
// habits/context profile the coach reasons from (`/coach/habits-profile`).
//
// Kept in its own module rather than bolted onto ./coach.ts, which is
// deliberately scoped to "what the chat screen calls" (see its header). These
// are account settings that happen to be namespaced under /coach on the API;
// nothing on the chat screen touches them.
//
// Ported from dw-time-web/src/features/settings/hooks/{use-byok-key,
// use-coach-profile}.ts and the coachApi block in dw-time-web/src/lib/api.ts.
// Two web-side behaviours are deliberately NOT carried over:
//
//   1. Web lowercases the provider on the client (`toClientProvider`) and
//      re-uppercases it on the way out. The wire format is uppercase, so
//      this module just uses the wire format throughout — one representation
//      instead of two, and no mapping table to keep in sync.
//   2. Web's `save()` for the habits profile PUTs all eleven fields every
//      time, including the eight its UI never shows, filling the absent ones
//      with hardcoded defaults (`sleepTargetHours: 8`, `bedtime: '23:00'`,
//      ...). The API's UpsertHabitsProfileDto forwards only the keys actually
//      present, so a partial PUT is a genuine partial update — sending just
//      `{ why }` cannot clobber a bedtime the user set on web.

import type { AxiosInstance } from 'axios'

// ---------------------------------------------------------------------------
// BYOK
// ---------------------------------------------------------------------------

/** Uppercase on the wire, matching dw-time-api's SaveByokKeyDto. */
export type CoachByokProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OPENROUTER'

export interface CoachByokState {
  status: 'unset' | 'active'
  provider?: CoachByokProvider | null
  /** e.g. `sk-...4f2a`. The full key is never returned by the API once stored. */
  maskedKey?: string | null
  tokensUsed?: number | null
  tokensLimit?: number | null
  selectedModel?: string | null
  /** Server-side whitelist. Populate any model picker from this, never a hardcoded list. */
  allowedModels?: string[]
  /** What the coach will actually use — `selectedModel`, or the provider's default. */
  effectiveModel?: string | null
  /** Operator-funded key that lets someone try the coach before bringing their own. */
  shared?: { available: boolean; used: number; limit: number }
}

export interface CoachByokUsage {
  tokensUsed: number
  tokensLimit: number
  windowStart: string
}

export interface CoachByokProviderMeta {
  provider: CoachByokProvider
  label: string
  /** Every key this provider issues starts with this. Checked before we send. */
  keyPrefix: string
  /** Where the user goes to mint a key. */
  consoleUrl: string
  /** One line of "how do I get one of these". */
  howTo: string
}

/**
 * Ordered free-tier-first, matching web's provider switcher: someone with no
 * key at all is best served by the one they can get without a card.
 */
export const COACH_BYOK_PROVIDERS: readonly CoachByokProviderMeta[] = [
  {
    provider: 'GEMINI',
    label: 'Google Gemini',
    keyPrefix: 'AIza',
    consoleUrl: 'https://aistudio.google.com/apikey',
    howTo: 'Free tier available. Create a key in Google AI Studio.',
  },
  {
    provider: 'OPENROUTER',
    label: 'OpenRouter',
    keyPrefix: 'sk-or-',
    consoleUrl: 'https://openrouter.ai/keys',
    howTo: 'One key, many models. Includes some free models.',
  },
  {
    provider: 'OPENAI',
    label: 'OpenAI',
    keyPrefix: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    howTo: 'Pay as you go. Create a key on the API keys page.',
  },
  {
    provider: 'ANTHROPIC',
    label: 'Anthropic',
    keyPrefix: 'sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    howTo: 'Pay as you go. Create a key under Settings -> API keys.',
  },
]

export function coachByokProviderMeta(provider: CoachByokProvider): CoachByokProviderMeta {
  const meta = COACH_BYOK_PROVIDERS.find((entry) => entry.provider === provider)
  // Every member of the union is in the table above; the fallback exists so
  // a provider added to the API before it's added here degrades to "unknown
  // provider, no prefix check" rather than crashing a settings screen.
  return meta ?? { provider, label: provider, keyPrefix: '', consoleUrl: '', howTo: '' }
}

/** Server-side bounds on the monthly token budget (dw-time-api's `@Min`/`@Max`). */
export const COACH_BYOK_MIN_TOKEN_BUDGET = 1_000
export const COACH_BYOK_MAX_TOKEN_BUDGET = 100_000_000

/**
 * The same local checks the API performs before it encrypts and stores a key
 * (`assertPrefixMatches` + a min length of 8), run client-side so a typo
 * costs a render rather than a round trip.
 *
 * Note what this is NOT: there is no "test this key" endpoint. The API never
 * calls the provider at save time, so a well-formed key for a cancelled
 * account still saves successfully and only fails later, in the chat.
 *
 * Returns `null` when the key looks acceptable, or a user-facing reason.
 */
export function validateCoachByokKey(provider: CoachByokProvider, rawKey: string): string | null {
  const key = rawKey.trim()
  if (key.length < 8) {
    return 'That key looks too short.'
  }
  const { keyPrefix, label } = coachByokProviderMeta(provider)
  if (keyPrefix && !key.startsWith(keyPrefix)) {
    return `${label} keys start with "${keyPrefix}".`
  }
  return null
}

/**
 * Normalises the budget field's free text. Users paste `1,000,000` and
 * `1_000_000` as readily as `1000000`, and both parse to `1` under a bare
 * `Number()` on the first comma.
 *
 * Returns `null` when the input isn't a usable budget.
 */
export function parseCoachByokBudget(input: string): number | null {
  const digits = input.replace(/[,_\s]/g, '')
  if (!/^\d+$/.test(digits)) return null
  const value = Number(digits)
  if (!Number.isFinite(value)) return null
  if (value < COACH_BYOK_MIN_TOKEN_BUDGET || value > COACH_BYOK_MAX_TOKEN_BUDGET) return null
  return value
}

/**
 * Human-readable token count for a budget or a usage figure: `375k`, `1.2M`.
 *
 * Budgets are six- and seven-digit numbers, and `250000` vs `2500000` is a
 * factor-of-ten difference that a glance at the digits genuinely misreads.
 */
export function formatCoachTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions.toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

// ---------------------------------------------------------------------------
// Budget-exceeded detection
// ---------------------------------------------------------------------------

/**
 * Whether a Coach failure is specifically "your BYOK monthly token budget is
 * spent", as opposed to any other reason the coach declined to answer.
 *
 * WHY THIS MATCHES ON THE MESSAGE, which is normally the wrong thing to do:
 * the API raises this as an `HttpException(429, { message: 'Monthly token
 * budget exceeded', tokensUsed, tokensLimit })` — but it raises it from
 * *inside* the async generator that backs the `@Sse()` chat endpoint. The
 * controller's `asSseObservable` bridge catches everything the generator
 * throws and re-emits it as a terminal SSE frame, `{ delta: '', done: true,
 * error: <message> }`, on a response whose status line was already sent as
 * 200. By the time the client sees it, the status code, the error code and
 * the `tokensUsed`/`tokensLimit` fields are all gone: a bare string is the
 * entire wire signal that survives. (See goal-slot-api
 * `coach-ai.controller.ts#asSseObservable` and
 * `coach-ai.service.ts#assertWithinBudget`.)
 *
 * So the string is matched deliberately loosely — "token budget" plus an
 * exhaustion word — rather than by equality, so a server-side reword of the
 * sentence doesn't silently turn the affordance off. Two things it must
 * never match, and there are tests for both:
 *
 *   - The shared-key ceiling ('Shared Coach daily limit reached...'), which
 *     is a different user in a different situation: they have no budget to
 *     raise, they need to add a key of their own.
 *   - A genuine HTTP 429 from the request throttler (30 messages/day), which
 *     carries no budget wording at all and is fixed by waiting, not paying.
 *
 * Accepts the raw SSE `chunk.error` string, or a thrown error/axios-style
 * object — the latter so this keeps working unchanged if the API ever moves
 * the check in front of the stream and it starts arriving as a real 429.
 */
export function isCoachBudgetExceededError(input: unknown): boolean {
  for (const candidate of collectErrorMessages(input)) {
    const text = candidate.toLowerCase()
    if (!text.includes('token budget')) continue
    if (/exceed|reached|used up|over|out of|remain/.test(text)) return true
  }
  return false
}

function collectErrorMessages(input: unknown): string[] {
  if (typeof input === 'string') return [input]
  if (!input || typeof input !== 'object') return []

  const out: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) out.push(value.filter((v): v is string => typeof v === 'string').join(', '))
  }

  const err = input as {
    message?: unknown
    error?: unknown
    response?: { data?: { message?: unknown; error?: unknown } }
  }
  push(err.message)
  push(err.error)
  push(err.response?.data?.message)
  push(err.response?.data?.error)
  return out
}

// ---------------------------------------------------------------------------
// Budget increments
// ---------------------------------------------------------------------------

export interface CoachBudgetIncrement {
  /** How much bigger than the current budget, e.g. 50 for "+50%". */
  percent: number
  /** The absolute budget to PATCH — already rounded and clamped to the API's bounds. */
  tokensLimit: number
}

/** The one-tap steps offered when the coach stops on a spent budget. */
export const COACH_BUDGET_INCREMENT_PERCENTS: readonly number[] = [50, 100, 200]

/**
 * Turn "the budget is 250k and it's gone" into the two or three absolute
 * numbers a user can pick between without doing arithmetic.
 *
 * Rounded UP to a readable step (nobody wants a 187,500-token budget) and
 * clamped to the server's `@Min`/`@Max`, so every option here is a value the
 * PATCH will actually accept. Options that collapse onto each other at the
 * ceiling are de-duplicated, and once the budget IS the ceiling the list is
 * empty — the caller should then say so rather than offer a no-op button.
 *
 * `current` tolerates null/0 (a state where the API hasn't told us the
 * budget yet) by treating the minimum as the base, so the sheet still
 * renders something tappable instead of a row of zeroes.
 */
export function coachBudgetIncrements(
  current: number | null | undefined,
  percents: readonly number[] = COACH_BUDGET_INCREMENT_PERCENTS,
): CoachBudgetIncrement[] {
  const base =
    typeof current === 'number' && Number.isFinite(current) && current >= COACH_BYOK_MIN_TOKEN_BUDGET
      ? current
      : COACH_BYOK_MIN_TOKEN_BUDGET

  const seen = new Set<number>()
  const out: CoachBudgetIncrement[] = []
  for (const percent of percents) {
    const raised = roundBudgetUp(base * (1 + percent / 100))
    const tokensLimit = Math.min(raised, COACH_BYOK_MAX_TOKEN_BUDGET)
    // A step that doesn't actually raise anything (already at the ceiling)
    // is worse than no button: it looks like an action and does nothing.
    if (tokensLimit <= base) continue
    if (seen.has(tokensLimit)) continue
    seen.add(tokensLimit)
    out.push({ percent, tokensLimit })
  }
  return out
}

/** Round to a step that reads as a decision rather than as a calculation. */
function roundBudgetUp(value: number): number {
  const step = value >= 1_000_000 ? 100_000 : value >= 100_000 ? 10_000 : value >= 10_000 ? 1_000 : 500
  return Math.max(COACH_BYOK_MIN_TOKEN_BUDGET, Math.ceil(value / step) * step)
}

// ---------------------------------------------------------------------------
// Habits profile
// ---------------------------------------------------------------------------

export type CoachReligiousContext =
  | 'NONE'
  | 'ISLAM'
  | 'CHRISTIANITY'
  | 'HINDUISM'
  | 'BUDDHISM'
  | 'JUDAISM'
  | 'SECULAR'
  | 'OTHER'

export const COACH_RELIGIOUS_CONTEXTS: readonly { value: CoachReligiousContext; label: string }[] = [
  { value: 'NONE', label: 'Prefer not to say' },
  { value: 'ISLAM', label: 'Islam' },
  { value: 'CHRISTIANITY', label: 'Christianity' },
  { value: 'HINDUISM', label: 'Hinduism' },
  { value: 'BUDDHISM', label: 'Buddhism' },
  { value: 'JUDAISM', label: 'Judaism' },
  { value: 'SECULAR', label: 'Secular' },
  { value: 'OTHER', label: 'Other' },
]

/**
 * Every field is optional because the API returns a defaults object with no
 * `id` (and, on a profile that has never been saved, no `religiousContext`
 * and no `spiritualNotes` either — see coach-profile.service.ts's
 * PROFILE_DEFAULTS). Treat absence as "not set", never as a value.
 */
export interface CoachHabitsProfile {
  id?: string
  userId?: string
  why?: string
  phoneBlockerInstalled?: boolean
  distractingSubsCancelled?: boolean
  websiteBlockerUrls?: string
  sleepTargetHours?: number
  bedtime?: string
  wakeTime?: string
  workEnvironment?: string
  additionalContext?: string
  religiousContext?: CoachReligiousContext
  spiritualNotes?: string
  createdAt?: string
  updatedAt?: string
}

export type UpsertCoachHabitsProfile = Omit<CoachHabitsProfile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>

// ---------------------------------------------------------------------------

export function createCoachSettingsApi(api: AxiosInstance) {
  return {
    getByokKey: () => api.get<CoachByokState>('/coach/byok-key'),
    saveByokKey: (data: { provider: CoachByokProvider; apiKey: string }) =>
      api.post<CoachByokState>('/coach/byok-key', data),
    deleteByokKey: () => api.delete<{ success: boolean }>('/coach/byok-key'),
    getByokUsage: () => api.get<CoachByokUsage>('/coach/byok-key/usage'),
    setByokModel: (model: string) => api.patch<CoachByokState>('/coach/byok-key/model', { model }),
    setByokBudget: (tokensLimit: number) =>
      api.patch<CoachByokState>('/coach/byok-key/budget', { tokensLimit }),

    getHabitsProfile: () => api.get<CoachHabitsProfile>('/coach/habits-profile'),
    updateHabitsProfile: (data: UpsertCoachHabitsProfile) =>
      api.put<CoachHabitsProfile>('/coach/habits-profile', data),
  }
}

export type CoachSettingsApi = ReturnType<typeof createCoachSettingsApi>
