import { describe, expect, it } from 'vitest'

import { isNamedTarget, namedTarget } from './intent'
import { parseVoiceCommand } from './parse'
import { nameSimilarity, rankTargets, resolveSpokenTarget, type TargetCandidate } from './resolve'

const GOALS: readonly TargetCandidate[] = [
  { id: 'goal_deen', name: 'Deen', kind: 'goal', aliases: ['Islamic Studies'] },
  { id: 'goal_fitness', name: 'Fitness', kind: 'goal' },
  { id: 'goal_quran', name: "Qur'an Study", kind: 'goal' },
  { id: 'task_invoices', name: 'Invoices', kind: 'task' },
]

/** The reporting user's list, near enough: a made-up brand beside a goal
 * whose name is an everyday word the same sentence also contains. */
const OLOSTEP_GOALS: readonly TargetCandidate[] = [
  { id: 'goal_olostep', name: 'OloStep', kind: 'goal' },
  { id: 'goal_work', name: 'Work', kind: 'goal' },
  { id: 'goal_deen', name: 'Deen', kind: 'goal' },
  { id: 'goal_fitness', name: 'Fitness', kind: 'goal' },
]

describe('resolveSpokenTarget', () => {
  it('resolves an exact name confidently', () => {
    const resolution = resolveSpokenTarget(namedTarget('goal', 'deen'), GOALS)
    expect(resolution.status).toBe('confident')
    expect(resolution.target?.id).toBe('goal_deen')
    expect(resolution.target?.score).toBe(1)
  })

  it('survives the vowel a recognizer gets wrong', () => {
    // "dean" for "Deen" is the exact failure this whole feature exists to
    // fix — the user could not find that goal by typing either.
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'dean'), GOALS)
    expect(resolution.target?.id).toBe('goal_deen')
    expect(resolution.status).toBe('confident')
  })

  it('matches an alias and reports which string won', () => {
    const resolution = resolveSpokenTarget(namedTarget('goal', 'islamic studies'), GOALS)
    expect(resolution.target?.id).toBe('goal_deen')
    expect(resolution.target?.matchedOn).toBe('Islamic Studies')
  })

  it('ignores an apostrophe the speaker never pronounced', () => {
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'quran study'), GOALS)
    expect(resolution.target?.id).toBe('goal_quran')
  })

  it('tolerates the kind word still hanging off the spoken name', () => {
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'deen goal'), GOALS)
    expect(resolution.target?.id).toBe('goal_deen')
  })

  it('narrows by kind when the speaker said one', () => {
    const asTask = resolveSpokenTarget(namedTarget('task', 'deen'), GOALS)
    expect(asTask.status).toBe('unresolved')

    const anyKind = resolveSpokenTarget(namedTarget('unspecified', 'invoices'), GOALS)
    expect(anyKind.target?.id).toBe('task_invoices')
  })
})

describe('resolveSpokenTarget — an invented brand name the recognizer keeps respelling', () => {
  // "It doesn't read Olostep properly." A name with no dictionary entry
  // behind it comes back spelled a different way almost every time, and
  // where the space lands is the part that moves most.
  it.each(['OloStep', 'olostep', 'Olostep', 'OLOSTEP', 'olo step', 'Olo Step', 'OLO STEP', 'ola step'])(
    'hears %s as the OloStep goal and acts on it',
    (said) => {
      const resolution = resolveSpokenTarget(namedTarget('unspecified', said), OLOSTEP_GOALS)
      expect(resolution.target?.id).toBe('goal_olostep')
      expect(resolution.status).toBe('confident')
    },
  )

  it('offers OloStep first for a mangling too far gone to act on unasked', () => {
    // "All of step" is what a recognizer reaches for when it insists on real
    // words. Close enough to head a "did you mean?", not close enough to
    // start a timer on — a wrong-goal timer is worse than a question.
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'all of step'), OLOSTEP_GOALS)
    expect(resolution.status).toBe('needs-confirmation')
    expect(resolution.candidates[0]?.id).toBe('goal_olostep')
  })

  it('never reaches an unrelated goal to fill the gap', () => {
    // The goal is simply absent here. Tolerating a misspelling must not
    // become tolerating a different word.
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'olostep'), [
      { id: 'goal_work', name: 'Work', kind: 'goal' },
      { id: 'goal_deen', name: 'Deen', kind: 'goal' },
      { id: 'goal_outreach', name: 'Outreach', kind: 'goal' },
      { id: 'goal_onestop', name: 'One Stop Shop', kind: 'goal' },
    ])
    expect(resolution.status).toBe('unresolved')
    expect(resolution.target).toBeNull()
  })
})

describe('the spoken sentence from the OloStep report, end to end', () => {
  it('starts a timer on OloStep instead of handing the sentence to the Coach', () => {
    // Both halves of the bug in one assertion: the parse has to name the
    // goal rather than the work, and the resolver has to be sure enough of
    // that name to act. Anything short of 'confident' here is how the user
    // ended up looking at proposed schedule edits.
    const intent = parseVoiceCommand('start tracking time for my work for Olostep')
    expect(intent.type).toBe('START_TRACKING')
    if (intent.type === 'UNKNOWN' || !isNamedTarget(intent.target)) throw new Error('unreachable')

    const resolution = resolveSpokenTarget(intent.target, OLOSTEP_GOALS)
    expect(resolution.status).toBe('confident')
    expect(resolution.target?.name).toBe('OloStep')
  })

  it.each([
    'Can you start tracking time for my work for Olostep?',
    'start tracking time for my work for olo step',
    'hey can you please start tracking time for my work for OloStep',
  ])('%s reaches the same goal', (said) => {
    const intent = parseVoiceCommand(said)
    if (intent.type === 'UNKNOWN' || !isNamedTarget(intent.target)) throw new Error('unreachable')
    const resolution = resolveSpokenTarget(intent.target, OLOSTEP_GOALS)
    expect(resolution.status).toBe('confident')
    expect(resolution.target?.id).toBe('goal_olostep')
  })
})

describe('resolveSpokenTarget — when it refuses to pick', () => {
  it('asks rather than flipping a coin between two equally close names', () => {
    // A task named after the goal it belongs to is the everyday version of
    // this, not a contrived one. Both score 1.0, so there is nothing to
    // choose between them but a coin.
    const twins: readonly TargetCandidate[] = [
      { id: 'goal_fitness', name: 'Fitness', kind: 'goal' },
      { id: 'task_fitness', name: 'Fitness', kind: 'task' },
    ]
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'fitness'), twins)
    expect(resolution.status).toBe('needs-confirmation')
    expect(resolution.reason).toBe('ambiguous')
    expect(resolution.candidates.map((c) => c.id)).toEqual(['goal_fitness', 'task_fitness'])
  })

  it('asks when the only match is a soft one', () => {
    // "deen study" against a goal called "Deen" — close enough to show, not
    // close enough to start a timer on without a word from the user.
    const resolution = resolveSpokenTarget(namedTarget('goal', 'deen study'), [
      { id: 'goal_deen', name: 'Deen', kind: 'goal' },
    ])
    expect(resolution.status).toBe('needs-confirmation')
    expect(resolution.reason).toBe('weak-match')
    expect(resolution.target?.id).toBe('goal_deen')
  })

  it('says nothing matched instead of offering the least-bad guess', () => {
    const resolution = resolveSpokenTarget(namedTarget('goal', 'woodworking'), GOALS)
    expect(resolution).toEqual({
      status: 'unresolved',
      target: null,
      candidates: [],
      reason: 'no-match',
    })
  })

  it('resolves nothing against an empty list, without throwing', () => {
    // A cold start with the goals query still in flight lands here.
    expect(resolveSpokenTarget(namedTarget('goal', 'deen'), []).status).toBe('unresolved')
  })

  it('carries the ranked runners-up so "which one?" is answerable in one pass', () => {
    const resolution = resolveSpokenTarget(namedTarget('unspecified', 'readin'), [
      { id: 'a', name: 'Reading', kind: 'goal' },
      { id: 'b', name: 'Readings', kind: 'goal' },
      { id: 'c', name: 'Woodwork', kind: 'goal' },
    ])
    expect(resolution.candidates.length).toBeGreaterThan(1)
    expect(resolution.candidates.map((c) => c.id)).not.toContain('c')
  })

  it('caps the candidate list so a prompt stays readable', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`,
      name: `Reading ${i}`,
      kind: 'goal' as const,
    }))
    expect(resolveSpokenTarget(namedTarget('goal', 'reading'), many, { maxCandidates: 3 }).candidates).toHaveLength(3)
  })
})

describe('rankTargets', () => {
  it('orders by score and breaks ties deterministically', () => {
    const first = rankTargets(namedTarget('goal', 'reading'), [
      { id: 'z', name: 'Reading', kind: 'goal' },
      { id: 'a', name: 'Reading', kind: 'goal' },
    ])
    const second = rankTargets(namedTarget('goal', 'reading'), [
      { id: 'a', name: 'Reading', kind: 'goal' },
      { id: 'z', name: 'Reading', kind: 'goal' },
    ])
    // Same answer whichever order the caller handed the records over in.
    expect(first.map((c) => c.id)).toEqual(['a', 'z'])
    expect(second.map((c) => c.id)).toEqual(['a', 'z'])
  })

  it('drops everything below the floor', () => {
    expect(rankTargets(namedTarget('goal', 'xyz'), GOALS)).toEqual([])
  })
})

describe('resolveSpokenTarget — resolving an APPEND_NOTE target', () => {
  // 'note' is just another TargetKind by the time it reaches here — this
  // pins that rankTargets/resolveSpokenTarget needed no changes at all to
  // support it, per the parser producing a real note-kind NamedTarget end
  // to end.
  const NOTES: readonly TargetCandidate[] = [
    { id: 'note_shopping_a', name: 'Shopping', kind: 'note' },
    { id: 'note_shopping_b', name: 'Shopping', kind: 'note' },
    { id: 'note_journal', name: 'Journal', kind: 'note' },
  ]

  it('resolves the target parseVoiceCommand produced for "add milk to my shopping notes"', () => {
    const intent = parseVoiceCommand('add milk to my journal notes')
    expect(intent.type).toBe('APPEND_NOTE')
    if (intent.type !== 'APPEND_NOTE') throw new Error('unreachable')
    expect(isNamedTarget(intent.target)).toBe(true)
    if (!isNamedTarget(intent.target)) throw new Error('unreachable')

    const resolution = resolveSpokenTarget(intent.target, NOTES)
    expect(resolution.status).toBe('confident')
    expect(resolution.target?.id).toBe('note_journal')
  })

  it('asks rather than guessing between two identically-named pages', () => {
    // Two pages titled the same thing is the everyday version of this, not
    // a contrived one — nothing stops a user from creating "Shopping" twice.
    const resolution = resolveSpokenTarget(namedTarget('note', 'shopping'), NOTES)
    expect(resolution.status).toBe('needs-confirmation')
    expect(resolution.reason).toBe('ambiguous')
    expect(resolution.candidates.map((c) => c.id)).toEqual(['note_shopping_a', 'note_shopping_b'])
  })

  it('narrows to notes only, leaving a same-named goal or task alone', () => {
    const mixed: readonly TargetCandidate[] = [...NOTES, { id: 'goal_journal', name: 'Journal', kind: 'goal' }]
    const resolution = resolveSpokenTarget(namedTarget('note', 'journal'), mixed)
    expect(resolution.target?.id).toBe('note_journal')
  })
})

describe('nameSimilarity', () => {
  it('scores an exact fold as 1', () => {
    expect(nameSimilarity("Qur'an Study", 'quran study')).toBe(1)
  })

  it('scores an unrelated pair near 0', () => {
    expect(nameSimilarity('deen', 'woodworking')).toBeLessThan(0.4)
  })

  it('does not let one shared word carry a much longer name', () => {
    expect(nameSimilarity('deen', 'deen fitness tracker')).toBeLessThan(0.6)
  })

  it('is symmetric and stable', () => {
    expect(nameSimilarity('dean', 'deen')).toBe(nameSimilarity('deen', 'dean'))
  })

  it('does not care where the recognizer put the space', () => {
    expect(nameSimilarity('olo step', 'OloStep')).toBe(1)
    expect(nameSimilarity('OloStep', 'Olo Step')).toBe(1)
    expect(nameSimilarity('one stop shop', 'OneStopShop')).toBe(1)
  })

  it('closing the spaces up does not make a longer name match', () => {
    // Whitespace-insensitive is not prefix-insensitive: the rest of the name
    // is still words the speaker never said.
    expect(nameSimilarity('olo step', 'Olostep Marketing Retainer')).toBeLessThan(0.6)
    expect(nameSimilarity('deen', 'Deen Fitness Tracker')).toBeLessThan(0.6)
  })
})
