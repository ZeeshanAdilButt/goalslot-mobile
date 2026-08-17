import { describe, expect, it } from 'vitest'

import {
  describeCoachProposalFailure,
  extractCoachProposals,
  normalizeCoachActionType,
  type CoachProposalFailure,
} from './proposals'
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

  it('accepts the note append type', () => {
    expect(normalizeCoachActionType('APPEND_NOTE_CONTENT')).toBe('APPEND_NOTE_CONTENT')
  })

  it.each([
    'CREATE_NOTE_CONTENT',
    'ADD_NOTE_CONTENT',
    'UPDATE_NOTE_CONTENT',
    'APPEND_NOTE',
    'ADD_NOTE',
    'ADD_TO_NOTE',
    'WRITE_NOTE',
    'APPEND_PAGE',
    'ADD_PAGE_CONTENT',
    'UPDATE_PAGE',
  ])('maps the note near-miss %s to APPEND_NOTE_CONTENT', (raw) => {
    expect(normalizeCoachActionType(raw)).toBe('APPEND_NOTE_CONTENT')
  })
})

describe('extractCoachProposals', () => {
  it('returns the raw text untouched when there is no proposal block', () => {
    const result = extractCoachProposals('Just a normal reply.')
    expect(result).toEqual({
      cleaned: 'Just a normal reply.',
      proposals: [],
      pending: false,
      unrenderable: null,
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
    expect(unrenderable).toBeNull()
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

  it('keeps an APPEND_NOTE_CONTENT action with its titleHint and content intact', () => {
    const raw = [
      '```coach-proposal',
      '{"summary":"Add to your research papers note","actions":[{"type":"APPEND_NOTE_CONTENT","payload":{"titleHint":"research papers","content":"read about dynamo"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toEqual([
      { type: 'APPEND_NOTE_CONTENT', payload: { titleHint: 'research papers', content: 'read about dynamo' } },
    ])
  })

  it('normalizes an APPEND_NOTE_CONTENT near-miss type inside the block', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"ADD_NOTE","payload":{"titleHint":"ideas","content":"ship v2"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions[0]?.type).toBe('APPEND_NOTE_CONTENT')
  })

  it('drops an unmappable action but keeps the rest of the batch, and is not flagged unrenderable', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"NONSENSE_TYPE"},{"type":"CREATE_TASK","payload":{"title":"Ship it"}}]}',
      '```',
    ].join('\n')

    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals[0]?.actions).toEqual([{ type: 'CREATE_TASK', payload: { title: 'Ship it' } }])
    expect(unrenderable).toBeNull()
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
    expect(unrenderable).toEqual({ reason: 'unknown-types', types: ['ARCHIVE_GOAL'] })
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
    expect(unrenderable).toEqual({ reason: 'empty-actions' })
  })

  it('drops a malformed block instead of throwing, flagged unrenderable', () => {
    const raw = ['Some text', '```coach-proposal', '{not json at all', '```', 'more text'].join('\n')
    expect(() => extractCoachProposals(raw)).not.toThrow()
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(unrenderable?.reason).toBe('bad-json')
  })

  it('flags unrenderable when the block has no actions field at all', () => {
    const raw = ['```coach-proposal', '{"summary":"oops"}', '```'].join('\n')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(unrenderable).toEqual({ reason: 'no-actions' })
  })

  it('does not flag unrenderable when no coach-proposal block is present at all', () => {
    const { unrenderable } = extractCoachProposals('Just a normal reply with no block.')
    expect(unrenderable).toBeNull()
  })

  it('does not flag unrenderable while a block is still streaming in, unclosed', () => {
    const raw = 'Here is a plan.\n```coach-proposal\n{"actions":[{"type":"CREATE_GOAL"'
    const { unrenderable, pending } = extractCoachProposals(raw)
    expect(pending).toBe(true)
    expect(unrenderable).toBeNull()
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
    expect(unrenderable).toBeNull()
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.actions[0]?.type).toBe('APPEND_JOURNAL_ENTRY')
    expect(proposals[0]?.actions[0]?.payload?.content).toBe('Felt scattered all afternoon.')
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
    expect(proposals[0]?.actions[0]?.payload?.date).toBe(todayKey())
  })

  it('leaves a date the model explicitly named alone', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"APPEND_JOURNAL_ENTRY","payload":{"content":"Monday was better.","date":"2026-08-10"}}]}',
      '```',
    ].join('\n')

    const { proposals } = extractCoachProposals(raw)
    expect(proposals[0]?.actions[0]?.payload?.date).toBe('2026-08-10')
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
    expect(proposals[0]?.actions[0]?.payload?.date).toBe('yesterday')
  })

  it('normalizes the model near-miss type and still fills the date', () => {
    const raw = [
      '```coach-proposal',
      '{"actions":[{"type":"CREATE_JOURNAL_ENTRY","payload":{"content":"Great workout"}}]}',
      '```',
    ].join('\n')

    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals[0]?.actions[0]).toEqual({
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
    expect(proposals[0]?.actions[0]?.payload).toEqual({ title: 'Ship it' })
  })
})

// ---------------------------------------------------------------------------
// The failure the user actually hit: the Coach's prose said "Here's the
// proposal:", no card rendered, and a single generic red line appeared —
// "Something went wrong preparing that change. Try asking again." — that was
// the SAME sentence for four different causes, with the parse error thrown
// away by a bare `catch {}`.
//
// These tests lock in both halves of the fix: the blocks that used to die
// silently now render, and the ones that genuinely cannot be recovered report
// a specific, diagnosable reason instead of a boolean.
// ---------------------------------------------------------------------------
describe('extractCoachProposals — malformed blocks that used to vanish', () => {
  const wrap = (body: string) =>
    ["I'll append \"customise\" to your notes. Here's the proposal:", '```coach-proposal', body, '```', 'Shall I go ahead and add this to your notes?'].join('\n')

  it('recovers a block whose summary contains unescaped inner double quotes', () => {
    // Verbatim the shape the model emits when it quotes the user's own word,
    // which is what its visible prose does one line above the fence.
    const raw = wrap(
      '{"summary": "Add "customise" to your learning notes", "actions": [{"type": "APPEND_NOTE_CONTENT", "payload": {"titleHint": "learning notes", "content": "customise"}}]}',
    )
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.summary).toBe('Add "customise" to your learning notes')
    expect(proposals[0]?.actions[0]).toEqual({
      type: 'APPEND_NOTE_CONTENT',
      payload: { titleHint: 'learning notes', content: 'customise' },
    })
  })

  it('recovers a block written with typographic smart quotes', () => {
    const raw = wrap('{“actions”: [{“type”: “CREATE_TASK”, “payload”: {“title”: “Call the bank”}}]}')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals[0]?.actions).toEqual([{ type: 'CREATE_TASK', payload: { title: 'Call the bank' } }])
  })

  it('recovers a block with a raw newline inside a string value', () => {
    const raw = wrap('{"actions":[{"type":"APPEND_NOTE_CONTENT","payload":{"titleHint":"Tech to learn","content":"line one\nline two"}}]}')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals[0]?.actions[0]?.payload?.content).toBe('line one\nline two')
  })

  it('accepts a singular "action" envelope', () => {
    const raw = wrap('{"summary":"Add it","action":{"type":"APPEND_NOTE_CONTENT","payload":{"titleHint":"Tech to learn","content":"customise"}}}')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals[0]?.actions).toEqual([
      { type: 'APPEND_NOTE_CONTENT', payload: { titleHint: 'Tech to learn', content: 'customise' } },
    ])
  })

  it('accepts an "actions" object that is not wrapped in an array', () => {
    const raw = wrap('{"actions":{"type":"CREATE_TASK","payload":{"title":"Ship it"}}}')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals[0]?.actions).toEqual([{ type: 'CREATE_TASK', payload: { title: 'Ship it' } }])
  })

  it.each(['APPEND_TO_NOTE', 'ADD_TO_NOTES', 'APPEND_NOTES', 'ADD_NOTES', 'CREATE_NOTE', 'NEW_NOTE', 'CREATE_PAGE', 'APPEND_NOTE_ENTRY'])(
    'maps the note near-miss %s rather than emptying the whole block',
    (type) => {
      const raw = wrap(`{"actions":[{"type":"${type}","payload":{"titleHint":"Tech to learn","content":"customise"}}]}`)
      const { proposals, unrenderable } = extractCoachProposals(raw)
      expect(unrenderable).toBeNull()
      expect(proposals[0]?.actions[0]?.type).toBe('APPEND_NOTE_CONTENT')
    },
  )
})

describe('extractCoachProposals — the repair pass must never touch valid JSON', () => {
  it('leaves URLs, // sequences and typographic apostrophes in valid JSON exactly as written', () => {
    // The repair heuristics are lossy by design (see escapeStrayQuotes). They
    // must only ever run on the retry, so a block that was valid all along is
    // byte-for-byte unaffected.
    const payload = {
      titleHint: "don’t forget",
      content: 'see https://x.com/a, and a // b -- plus a "quoted" word',
    }
    const raw = ['```coach-proposal', JSON.stringify({ actions: [{ type: 'APPEND_NOTE_CONTENT', payload }] }), '```'].join('\n')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toBeNull()
    expect(proposals[0]?.actions[0]?.payload).toEqual(payload)
  })
})

describe('extractCoachProposals — failures report a specific, diagnosable reason', () => {
  it('reports bad-json with the parse error and the offending block, not a bare flag', () => {
    const raw = ['Some text', '```coach-proposal', '{not json at all', '```', 'more text'].join('\n')
    const { unrenderable } = extractCoachProposals(raw)
    expect(unrenderable?.reason).toBe('bad-json')
    // The bare `catch {}` this replaces is why the live occurrence could not
    // be diagnosed from anything but screenshots.
    expect(unrenderable?.reason === 'bad-json' && unrenderable.detail.length).toBeGreaterThan(0)
    expect(unrenderable?.reason === 'bad-json' && unrenderable.raw).toBe('{not json at all')
  })

  it('reports the genuinely undecidable quote case honestly rather than mangling it', () => {
    // `"` followed by `,` is indistinguishable from a real string terminator.
    // No repair can win this; the contract is that it fails LOUDLY and
    // specifically, which is what makes the retry affordance worth offering.
    const raw = ['```coach-proposal', '{"summary": "He said "hi", then left", "actions": []}', '```'].join('\n')
    const { proposals, unrenderable } = extractCoachProposals(raw)
    expect(proposals).toEqual([])
    expect(unrenderable).not.toBeNull()
    expect(unrenderable?.reason).toBe('bad-json')
  })

  it('names the action types it could not apply', () => {
    const raw = ['```coach-proposal', '{"actions":[{"type":"ARCHIVE_GOAL"},{"type":"SHARE_NOTE"}]}', '```'].join('\n')
    const { unrenderable } = extractCoachProposals(raw)
    expect(unrenderable).toEqual({ reason: 'unknown-types', types: ['ARCHIVE_GOAL', 'SHARE_NOTE'] })
  })

  it('distinguishes an absent actions field from an empty one', () => {
    const noField = extractCoachProposals(['```coach-proposal', '{"summary":"oops"}', '```'].join('\n'))
    const emptyList = extractCoachProposals(['```coach-proposal', '{"actions":[]}', '```'].join('\n'))
    expect(noField.unrenderable).toEqual({ reason: 'no-actions' })
    expect(emptyList.unrenderable).toEqual({ reason: 'empty-actions' })
  })
})

describe('describeCoachProposalFailure', () => {
  it('names the offending action type', () => {
    expect(describeCoachProposalFailure({ reason: 'unknown-types', types: ['ARCHIVE_GOAL'] })).toBe(
      'The Coach proposed "ARCHIVE_GOAL", which this version of the app can\'t apply. Nothing was changed.',
    )
  })

  it('lists every offending action type', () => {
    expect(describeCoachProposalFailure({ reason: 'unknown-types', types: ['ARCHIVE_GOAL', 'SHARE_NOTE'] })).toContain(
      '"ARCHIVE_GOAL", "SHARE_NOTE"',
    )
  })

  it('falls back to a readable sentence when the model emitted no type at all', () => {
    expect(describeCoachProposalFailure({ reason: 'unknown-types', types: ['(no type)'] })).toBe(
      "The Coach's change didn't name an action this app recognises. Nothing was changed.",
    )
  })

  it('explains an unreadable block', () => {
    expect(describeCoachProposalFailure({ reason: 'bad-json', detail: 'Unexpected token n', raw: '{not json' })).toBe(
      "The Coach's change didn't arrive in a form the app could read, so there's nothing to approve. Nothing was changed.",
    )
  })

  it('explains a proposal that carried no action', () => {
    const expected = "The Coach said it prepared a change but didn't include one. Nothing was changed."
    expect(describeCoachProposalFailure({ reason: 'no-actions' })).toBe(expected)
    expect(describeCoachProposalFailure({ reason: 'empty-actions' })).toBe(expected)
  })

  // The regression guard proper. The whole incident was one sentence standing
  // in for four causes; if anyone collapses these back to a generic string,
  // this fails.
  it.each<[CoachProposalFailure]>([
    [{ reason: 'bad-json', detail: 'x', raw: 'y' }],
    [{ reason: 'no-actions' }],
    [{ reason: 'empty-actions' }],
    [{ reason: 'unknown-types', types: ['ARCHIVE_GOAL'] }],
  ])('never falls back to a generic "something went wrong" (%o)', (failure) => {
    const copy = describeCoachProposalFailure(failure)
    expect(copy.toLowerCase()).not.toContain('something went wrong')
    expect(copy).toContain('Nothing was changed.')
  })

  it('gives a distinct message for every failure reason', () => {
    const messages = [
      describeCoachProposalFailure({ reason: 'bad-json', detail: 'x', raw: 'y' }),
      describeCoachProposalFailure({ reason: 'no-actions' }),
      describeCoachProposalFailure({ reason: 'unknown-types', types: ['ARCHIVE_GOAL'] }),
    ]
    expect(new Set(messages).size).toBe(messages.length)
  })
})
