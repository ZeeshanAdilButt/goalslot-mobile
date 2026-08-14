import { describe, expect, it } from 'vitest'

import { extractCoachProposals, normalizeCoachActionType } from './proposals'
import { todayKey } from '../scheduling/time'

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

  it('accepts the live timer types', () => {
    expect(normalizeCoachActionType('START_TIMER')).toBe('START_TIMER')
    expect(normalizeCoachActionType('STOP_TIMER')).toBe('STOP_TIMER')
  })

  it.each([
    ['START_TRACKING', 'START_TIMER'],
    ['BEGIN_TIMER', 'START_TIMER'],
    ['TRACK_TIME', 'START_TIMER'],
    ['STOP_TRACKING', 'STOP_TIMER'],
    ['END_TIMER', 'STOP_TIMER'],
  ])('maps the near-miss %s to %s', (raw, expected) => {
    expect(normalizeCoachActionType(raw)).toBe(expected)
  })

  it('accepts the journal append type', () => {
    expect(normalizeCoachActionType('APPEND_JOURNAL_ENTRY')).toBe('APPEND_JOURNAL_ENTRY')
  })

  // The action the user reported twice as not working. The model reaches for
  // all of these names, and an unmapped one is dropped silently — which is
  // exactly what "it still cannot add entries to my journal" looked like.
  it.each([
    'CREATE_JOURNAL_ENTRY',
    'ADD_JOURNAL_ENTRY',
    'UPDATE_JOURNAL_ENTRY',
    'APPEND_JOURNAL',
    'ADD_JOURNAL',
    'WRITE_JOURNAL',
    'JOURNAL_ENTRY',
  ])('maps the journal near-miss %s to APPEND_JOURNAL_ENTRY', (raw) => {
    expect(normalizeCoachActionType(raw)).toBe('APPEND_JOURNAL_ENTRY')
  })

  it('maps a lowercase timer near-miss, as dictated input tends to arrive', () => {
    expect(normalizeCoachActionType('start_tracking')).toBe('START_TIMER')
  })
})

describe('extractCoachProposals', () => {
  it('returns the raw text untouched when there is no proposal block', () => {
    const result = extractCoachProposals('Just a normal reply.')
    expect(result).toEqual({
      cleaned: 'Just a normal reply.',
      proposals: [],
      pending: false,
      unrenderable: false,
    })
  })

  it('parses a closed coach-proposal block and strips it from the text', () => {
    const raw = [
      'Here is a plan.',
      '```coach-proposal',
      '{"summary":"Add a goal","actions":[{"type":"CREATE_GOAL","payload":{"title":"Read more"}}]}',
      '```',
      'Let me know what you think.',
    ].join('\n')

    const { cleaned, proposals, pending, unrenderable } = extractCoachProposals(raw)
    expect(pending).toBe(false)
    expect(unrenderable).toBe(false)
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

  it('keeps a START_TIMER action rather than dropping it as unknown', () => {
    const raw = [
      '```coach-proposal',
      '{"summary":"Start tracking time against \'Deen\'","actions":[{"type":"START_TIMER","payload":{"goalId":"g1","taskName":"Deen"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toEqual([
      { type: 'START_TIMER', payload: { goalId: 'g1', taskName: 'Deen' } },
    ])
  })

  it('keeps a STOP_TIMER action with an empty payload', () => {
    const raw = ['```coach-proposal', '{"actions":[{"type":"STOP_TIMER","payload":{}}]}', '```'].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toEqual([{ type: 'STOP_TIMER', payload: {} }])
  })

  it('drops an unmappable action but keeps the rest of the batch, and is not flagged unrenderable', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"NONSENSE_TYPE"},{"type":"CREATE_TASK","payload":{"title":"Ship it"}}]}',
      '```',
    ].join('\n')

    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toEqual([{ type: 'CREATE_TASK', payload: { title: 'Ship it' } }])
    expect(unrenderable).toBe(false)
  })

  it('flags unrenderable when every action in the block is an unknown type', () => {
    // This is the shape of the original journal bug: the model claims it
    // prepared a proposal for something with no corresponding action type, so
    // every action fails to normalize and the block would otherwise vanish
    // with no trace, leaving the assistant's "I've prepared a proposal" text
    // as the only thing on screen. Journal entries ARE an action now
    // (APPEND_JOURNAL_ENTRY), so this uses a type that genuinely isn't one —
    // the flag has to keep working for whatever the model invents next.
    const raw = [
      '```coach-proposal',
      '{"summary":"Archive it","actions":[{"type":"ARCHIVE_GOAL","payload":{"id":"g1"}}]}',
      '```',
    ].join('\n')

    const { proposals, unrenderable, cleaned } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(unrenderable).toBe(true)
    expect(cleaned).toBe('')
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

  it('drops a proposal block whose actions array is empty, flagged unrenderable', () => {
    const raw = ['```coach-proposal', '{"actions":[]}', '```'].join('\n')
    const { proposals, cleaned, unrenderable } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(cleaned).toBe('')
    expect(unrenderable).toBe(true)
  })

  it('drops a malformed block instead of throwing, flagged unrenderable', () => {
    const raw = ['Some text', '```coach-proposal', '{not json at all', '```', 'more text'].join('\n')
    expect(() => extractCoachProposals(raw)).not.toThrow()
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(unrenderable).toBe(true)
  })

  it('flags unrenderable when the block has no actions field at all', () => {
    const raw = ['```coach-proposal', '{"summary":"oops"}', '```'].join('\n')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(unrenderable).toBe(true)
  })

  it('does not flag unrenderable when no coach-proposal block is present at all', () => {
    const { unrenderable } = extractCoachProposals('Just a normal reply with no block.')
    expect(unrenderable).toBe(false)
  })

  it('does not flag unrenderable while a block is still streaming in, unclosed', () => {
    const raw = 'Here is a plan.\n```coach-proposal\n{"actions":[{"type":"CREATE_GOAL"'
    const { unrenderable, pending } = extractCoachProposals(raw)
    expect(pending).toBe(true)
    expect(unrenderable).toBe(false)
  })
})

describe('extractCoachProposals — APPEND_JOURNAL_ENTRY', () => {
  it('renders a journal append as a real proposal instead of dropping it', () => {
    const raw = [
      '```coach-proposal',
      '{"summary":"Add to today\'s journal","actions":[{"type":"APPEND_JOURNAL_ENTRY","payload":{"content":"Felt scattered all afternoon."}}]}',
      '```',
      "I've put that in today's journal for you to approve.",
    ].join('\n')

    const { proposals, unrenderable, cleaned } = extractCoachProposals(raw)
    expect(unrenderable).toBe(false)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].actions[0].type).toBe('APPEND_JOURNAL_ENTRY')
    expect(proposals[0].actions[0].payload?.content).toBe('Felt scattered all afternoon.')
    expect(cleaned).toBe("I've put that in today's journal for you to approve.")
  })

  it("fills in the device's local day when the model omitted the date", () => {
    // The server's own fallback is UTC, which is the wrong calendar day for a
    // user far enough east or west — see fillJournalDates.
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"APPEND_JOURNAL_ENTRY","payload":{"content":"No date given."}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0].actions[0].payload?.date).toBe(todayKey())
  })

  it('leaves a date the model explicitly named alone', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"APPEND_JOURNAL_ENTRY","payload":{"content":"Monday was better.","date":"2026-08-10"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0].actions[0].payload?.date).toBe('2026-08-10')
  })

  it('leaves a malformed date alone so the server rejects it loudly', () => {
    // Quietly rewriting "yesterday" to today would put the paragraph on a day
    // the user did not ask for, which is worse than a visible failure.
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"APPEND_JOURNAL_ENTRY","payload":{"content":"Hi","date":"yesterday"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0].actions[0].payload?.date).toBe('yesterday')
  })

  it('normalizes the model near-miss type and still fills the date', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"CREATE_JOURNAL_ENTRY","payload":{"content":"Great workout"}}]}',
      '```',
    ].join('\n')

    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBe(false)
    expect(proposals[0].actions[0]).toEqual({
      type: 'APPEND_JOURNAL_ENTRY',
      payload: { content: 'Great workout', date: todayKey() },
    })
  })

  it('does not touch the payload of any other action type', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"CREATE_TASK","payload":{"title":"Ship it"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0].actions[0].payload).toEqual({ title: 'Ship it' })
  })
})
