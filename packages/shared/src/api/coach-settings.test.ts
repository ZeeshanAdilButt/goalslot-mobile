import { describe, expect, it } from 'vitest'

import {
  COACH_BYOK_MAX_TOKEN_BUDGET,
  COACH_BYOK_MIN_TOKEN_BUDGET,
  COACH_BYOK_PROVIDERS,
  coachBudgetIncrements,
  coachByokProviderMeta,
  formatCoachTokenCount,
  isCoachBudgetExceededError,
  parseCoachByokBudget,
  validateCoachByokKey,
} from './coach-settings'

describe('validateCoachByokKey', () => {
  it('accepts a well-formed key for each provider', () => {
    expect(validateCoachByokKey('OPENAI', 'sk-abcdefghijklmnop')).toBeNull()
    expect(validateCoachByokKey('ANTHROPIC', 'sk-ant-abcdefghijklmnop')).toBeNull()
    expect(validateCoachByokKey('GEMINI', 'AIzaSyABCDEFGHIJKLMNOP')).toBeNull()
    expect(validateCoachByokKey('OPENROUTER', 'sk-or-abcdefghijklmnop')).toBeNull()
  })

  it('names the expected prefix when the key belongs to a different provider', () => {
    // The single most likely mistake: the picker is on one provider and the
    // key on the clipboard is from another. Saying which prefix was expected
    // is the difference between a fixable error and a shrug.
    expect(validateCoachByokKey('ANTHROPIC', 'sk-abcdefghijklmnop')).toContain('sk-ant-')
    expect(validateCoachByokKey('GEMINI', 'sk-abcdefghijklmnop')).toContain('AIza')
  })

  it('rejects a key shorter than the API will accept', () => {
    // The API's own DTO is `@MinLength(8)`; failing here saves a round trip
    // that would come back a 400.
    expect(validateCoachByokKey('OPENAI', 'sk-abc')).not.toBeNull()
  })

  it('trims before checking, so a pasted key with trailing whitespace passes', () => {
    // Long-press paste on iOS routinely carries a trailing newline.
    expect(validateCoachByokKey('OPENAI', '  sk-abcdefghijklmnop\n')).toBeNull()
  })

  it('treats an anthropic key as valid for anthropic even though it also starts with sk-', () => {
    // `sk-ant-` is a superset of OpenAI's `sk-`, so the ordering of the
    // provider table must not let an Anthropic key silently validate as
    // OpenAI's shape and get stored against the wrong provider.
    expect(validateCoachByokKey('OPENAI', 'sk-ant-abcdefghijklmnop')).toBeNull()
    expect(validateCoachByokKey('ANTHROPIC', 'sk-ant-abcdefghijklmnop')).toBeNull()
  })
})

describe('parseCoachByokBudget', () => {
  it('accepts plain digits inside the server-enforced bounds', () => {
    expect(parseCoachByokBudget('100000')).toBe(100_000)
    expect(parseCoachByokBudget(String(COACH_BYOK_MIN_TOKEN_BUDGET))).toBe(COACH_BYOK_MIN_TOKEN_BUDGET)
    expect(parseCoachByokBudget(String(COACH_BYOK_MAX_TOKEN_BUDGET))).toBe(COACH_BYOK_MAX_TOKEN_BUDGET)
  })

  it('strips the separators people actually type', () => {
    // `Number('1,000,000')` is NaN and `parseInt` stops at the first comma
    // and yields 1 — the silent-wrong-answer case this exists to prevent.
    expect(parseCoachByokBudget('1,000,000')).toBe(1_000_000)
    expect(parseCoachByokBudget('1_000_000')).toBe(1_000_000)
    expect(parseCoachByokBudget(' 250 000 ')).toBe(250_000)
  })

  it('rejects values outside the range the API will accept', () => {
    expect(parseCoachByokBudget('999')).toBeNull()
    expect(parseCoachByokBudget('100000001')).toBeNull()
  })

  it('rejects anything that is not a whole number of tokens', () => {
    expect(parseCoachByokBudget('')).toBeNull()
    expect(parseCoachByokBudget('lots')).toBeNull()
    expect(parseCoachByokBudget('1e6')).toBeNull()
    expect(parseCoachByokBudget('-100000')).toBeNull()
    expect(parseCoachByokBudget('100000.5')).toBeNull()
  })
})

describe('coachByokProviderMeta', () => {
  it('has an entry for every provider in the union', () => {
    for (const provider of ['OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENROUTER'] as const) {
      expect(coachByokProviderMeta(provider).provider).toBe(provider)
      expect(coachByokProviderMeta(provider).consoleUrl).toMatch(/^https:\/\//)
    }
  })

  it('lists the free-tier provider first', () => {
    // A user with no key at all should meet the option they can act on
    // without a credit card before the ones they can't.
    expect(COACH_BYOK_PROVIDERS[0]?.provider).toBe('GEMINI')
  })
})

describe('isCoachBudgetExceededError', () => {
  // The exact string the API's asSseObservable bridge forwards for
  // assertWithinBudget's HttpException, which is all the client ever sees.
  const SSE_MESSAGE = 'Monthly token budget exceeded'

  it('matches the message the SSE stream actually delivers', () => {
    expect(isCoachBudgetExceededError(SSE_MESSAGE)).toBe(true)
  })

  it('survives a reword of that sentence', () => {
    expect(isCoachBudgetExceededError('Your monthly token budget has been used up.')).toBe(true)
    expect(isCoachBudgetExceededError('Out of monthly token budget')).toBe(true)
    expect(isCoachBudgetExceededError('MONTHLY TOKEN BUDGET EXCEEDED')).toBe(true)
  })

  it('does NOT match the shared-key daily ceiling', () => {
    // A different user in a different situation: no budget of their own to
    // raise. Offering "increase your budget" here would be a dead end.
    expect(
      isCoachBudgetExceededError(
        'Shared Coach daily limit reached. Add your own free Gemini or OpenRouter key in Settings to keep going.',
      ),
    ).toBe(false)
  })

  it('does NOT match an unrelated failure, including a throttler 429', () => {
    expect(isCoachBudgetExceededError('Request failed (429)')).toBe(false)
    expect(isCoachBudgetExceededError('ThrottlerException: Too Many Requests')).toBe(false)
    expect(isCoachBudgetExceededError('Internal error during streaming')).toBe(false)
    expect(isCoachBudgetExceededError(null)).toBe(false)
    expect(isCoachBudgetExceededError(undefined)).toBe(false)
    expect(isCoachBudgetExceededError({})).toBe(false)
  })

  it('reads a thrown error or an axios response body, not just a bare string', () => {
    // Insurance: if the API ever moves the check in front of the stream this
    // arrives as a real 429 instead, and the affordance must not vanish.
    expect(isCoachBudgetExceededError(Object.assign(new Error(SSE_MESSAGE), { status: 429 }))).toBe(true)
    expect(isCoachBudgetExceededError({ response: { data: { message: SSE_MESSAGE } } })).toBe(true)
    expect(isCoachBudgetExceededError({ response: { data: { message: ['x', SSE_MESSAGE] } } })).toBe(true)
  })
})

describe('coachBudgetIncrements', () => {
  it('offers absolute values, rounded to something a person would choose', () => {
    expect(coachBudgetIncrements(250_000)).toEqual([
      { percent: 50, tokensLimit: 380_000 },
      { percent: 100, tokensLimit: 500_000 },
      { percent: 200, tokensLimit: 750_000 },
    ])
  })

  it('rounds up, never below the raw increment the label promises', () => {
    for (const { percent, tokensLimit } of coachBudgetIncrements(12_345)) {
      expect(tokensLimit).toBeGreaterThanOrEqual(12_345 * (1 + percent / 100))
    }
  })

  it('never proposes a value the API would reject', () => {
    for (const base of [0, 1_000, 12_345, 250_000, 60_000_000, COACH_BYOK_MAX_TOKEN_BUDGET]) {
      for (const { tokensLimit } of coachBudgetIncrements(base)) {
        expect(tokensLimit).toBeGreaterThanOrEqual(COACH_BYOK_MIN_TOKEN_BUDGET)
        expect(tokensLimit).toBeLessThanOrEqual(COACH_BYOK_MAX_TOKEN_BUDGET)
      }
    }
  })

  it('de-duplicates steps that collapse onto the ceiling', () => {
    const options = coachBudgetIncrements(90_000_000)
    expect(options).toHaveLength(1)
    expect(options[0]?.tokensLimit).toBe(COACH_BYOK_MAX_TOKEN_BUDGET)
  })

  it('offers nothing at all once the budget is the ceiling', () => {
    // A button that cannot raise anything must not render.
    expect(coachBudgetIncrements(COACH_BYOK_MAX_TOKEN_BUDGET)).toEqual([])
  })

  it('falls back to the minimum when the current budget is unknown', () => {
    expect(coachBudgetIncrements(null)[0]?.tokensLimit).toBe(1_500)
    expect(coachBudgetIncrements(undefined)).toEqual(coachBudgetIncrements(COACH_BYOK_MIN_TOKEN_BUDGET))
    expect(coachBudgetIncrements(0)).toEqual(coachBudgetIncrements(COACH_BYOK_MIN_TOKEN_BUDGET))
  })

  it('honours a caller-supplied set of steps', () => {
    expect(coachBudgetIncrements(100_000, [25])).toEqual([{ percent: 25, tokensLimit: 130_000 }])
  })
})

describe('formatCoachTokenCount', () => {
  it('keeps six- and seven-digit budgets legible at a glance', () => {
    expect(formatCoachTokenCount(375_000)).toBe('375k')
    expect(formatCoachTokenCount(1_000_000)).toBe('1M')
    expect(formatCoachTokenCount(1_250_000)).toBe('1.3M')
    expect(formatCoachTokenCount(1_000)).toBe('1k')
    expect(formatCoachTokenCount(940)).toBe('940')
    expect(formatCoachTokenCount(0)).toBe('0')
  })
})
