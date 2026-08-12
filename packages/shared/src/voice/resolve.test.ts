import { describe, expect, it } from 'vitest'

import { namedTarget } from './intent'
import { nameSimilarity, rankTargets, resolveSpokenTarget, type TargetCandidate } from './resolve'

const GOALS: readonly TargetCandidate[] = [
  { id: 'goal_deen', name: 'Deen', kind: 'goal', aliases: ['Islamic Studies'] },
  { id: 'goal_fitness', name: 'Fitness', kind: 'goal' },
  { id: 'goal_quran', name: "Qur'an Study", kind: 'goal' },
  { id: 'task_invoices', name: 'Invoices', kind: 'task' },
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
})
