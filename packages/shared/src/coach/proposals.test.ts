import { describe, expect, it } from 'vitest'

import { extractCoachProposals, normalizeCoachActionType } from './proposals'

describe('normalizeCoachActionType', () => {
  it('accepts a canonical type as-is', () => {
    expect(normalizeCoachActionType('CREATE_GOAL')).toBe('CREATE_GOAL')
  })

  it('is case-insensitive', () => {
    expect(normalizeCoachActionType('create_goal')).toBe('CREATE_GOAL')
  })

  it('maps a known synonym to its canonical type', () => {
    expect(normalizeCoachActionType('ADD_SCHEDULE_BLOCK')).toBe('CREATE_SCHEDULE_BLOCK')
  })

  it('returns null for an unmappable type', () => {
    expect(normalizeCoachActionType('DO_SOMETHING_WEIRD')).toBeNull()
  })

  it('returns null for a non-string input', () => {
    expect(normalizeCoachActionType(42)).toBeNull()
  })
})

describe('extractCoachProposals', () => {
  it('returns the raw text untouched when there is no proposal block', () => {
    const result = extractCoachProposals('Just a normal reply.')
    expect(result).toEqual({ cleaned: 'Just a normal reply.', proposals: [], pending: false })
  })

  it('parses a closed coach-proposal block and strips it from the text', () => {
    const raw = [
      'Here is a plan.',
      '```coach-proposal',
      '{"summary":"Add a goal","actions":[{"type":"CREATE_GOAL","payload":{"title":"Read more"}}]}',
      '```',
      'Let me know what you think.',
    ].join('\n')

    const { cleaned, proposals, pending } = extractCoachProposals(raw)
    expect(pending).toBe(false)
    expect(cleaned).toBe('Here is a plan.\n\nLet me know what you think.')
    expect(proposals).toEqual([
      {
        summary: 'Add a goal',
        actions: [{ type: 'CREATE_GOAL', payload: { title: 'Read more' } }],
      },
    ])
  })

  it('normalizes a synonym action type inside the block instead of dropping the whole proposal', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"ADD_SCHEDULE_BLOCK","payload":{"title":"Gym","dayOfWeek":1,"startTime":"06:00","endTime":"07:00"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions[0]?.type).toBe('CREATE_SCHEDULE_BLOCK')
  })

  it('drops an unmappable action but keeps the rest of the batch', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"NONSENSE_TYPE"},{"type":"CREATE_TASK","payload":{"title":"Ship it"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toEqual([{ type: 'CREATE_TASK', payload: { title: 'Ship it' } }])
  })

  it('tolerates trailing commas and // comments in the JSON block', () => {
    const raw = [
      '```coach-proposal',
      '{',
      '  // proposed change',
      '  "actions": [',
      '    { "type": "CREATE_GOAL", "payload": { "title": "Read more", } },',
      '  ],',
      '}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals).toEqual([{ summary: undefined, actions: [{ type: 'CREATE_GOAL', payload: { title: 'Read more' } }] }])
  })

  it('collapses repeated single-day schedule blocks into one multi-day action', () => {
    const days = [1, 2, 3, 4, 5].map(
      (d) =>
        `{"type":"CREATE_SCHEDULE_BLOCK","payload":{"title":"Focus","startTime":"09:00","endTime":"10:00","dayOfWeek":${d}}}`,
    )
    const raw = ['```coach-proposal', `{"actions":[${days.join(',')}]}`, '```'].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toHaveLength(1)
    expect(proposals[0]?.actions[0]?.payload).toMatchObject({ daysOfWeek: [1, 2, 3, 4, 5] })
  })

  it('flags pending and hides the tail while a block is still streaming in, unclosed', () => {
    const raw = 'Here is a plan.\n```coach-proposal\n{"actions":[{"type":"CREATE_GOAL"'
    const { cleaned, proposals, pending } = extractCoachProposals(raw)
    expect(pending).toBe(true)
    expect(proposals).toEqual([])
    expect(cleaned).toBe('Here is a plan.')
  })

  it('hides a partially-typed opening fence at the tail', () => {
    const raw = 'Here is a plan.\n```coach'
    const { cleaned, pending } = extractCoachProposals(raw)
    expect(pending).toBe(true)
    expect(cleaned).toBe('Here is a plan.')
  })

  it('drops a proposal block whose actions array is empty', () => {
    const raw = ['```coach-proposal', '{"actions":[]}', '```'].join('\n')
    const { proposals, cleaned } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(cleaned).toBe('')
  })

  it('drops a malformed block instead of throwing', () => {
    const raw = ['Some text', '```coach-proposal', '{not json at all', '```', 'more text'].join('\n')
    expect(() => extractCoachProposals(raw)).not.toThrow()
    const { proposals } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
  })
})
