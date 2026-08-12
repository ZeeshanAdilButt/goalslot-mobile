import { describe, expect, it } from 'vitest'

import {
  COACH_BYOK_MAX_TOKEN_BUDGET,
  COACH_BYOK_MIN_TOKEN_BUDGET,
  COACH_BYOK_PROVIDERS,
  coachByokProviderMeta,
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
