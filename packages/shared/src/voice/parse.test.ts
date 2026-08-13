import { describe, expect, it } from 'vitest'

import { findSpokenDuration, parseVoiceCommand } from './parse'
import { describeVoiceIntent, isNamedTarget, isReversibleVoiceIntent } from './intent'

/** Narrowing helper — every assertion below cares about the target. */
function targetOf(transcript: string): { kind: string; name: string } | null {
  const intent = parseVoiceCommand(transcript)
  if (intent.type === 'UNKNOWN') return null
  return isNamedTarget(intent.target) ? { kind: intent.target.kind, name: intent.target.name } : null
}

describe('parseVoiceCommand — the commands the Time Tracker offers', () => {
  it('reads the phrasing from the original complaint', () => {
    const intent = parseVoiceCommand('start tracking time for my deen goal')
    expect(intent.type).toBe('START_TRACKING')
    expect(targetOf('start tracking time for my deen goal')).toEqual({ kind: 'goal', name: 'deen' })
  })

  it.each([
    ['start', 'START_TRACKING'],
    ['begin', 'START_TRACKING'],
    ['clock in', 'START_TRACKING'],
    ['stop', 'STOP_TRACKING'],
    ['stop tracking', 'STOP_TRACKING'],
    ['clock out', 'STOP_TRACKING'],
    ['pause', 'PAUSE'],
    ['pause the timer', 'PAUSE'],
    ['take a break', 'PAUSE'],
    ['resume', 'RESUME'],
    ['unpause', 'RESUME'],
    ['back to work', 'RESUME'],
  ])('%s parses as %s', (transcript, type) => {
    expect(parseVoiceCommand(transcript).type).toBe(type)
  })

  it('all four transport commands are reversible, and logging is not', () => {
    for (const said of ['start', 'stop', 'pause', 'resume']) {
      expect(isReversibleVoiceIntent(parseVoiceCommand(said))).toBe(true)
    }
    expect(isReversibleVoiceIntent(parseVoiceCommand('log 30 minutes to deen'))).toBe(false)
  })

  it('strips filler, politeness and casing before matching', () => {
    const padded = parseVoiceCommand('Hey, um, can you please start tracking my Deen goal, thanks?')
    expect(padded.type).toBe('START_TRACKING')
    expect(targetOf('Hey, um, can you please start tracking my Deen goal, thanks?')).toEqual({
      kind: 'goal',
      name: 'deen',
    })
  })

  it('keeps the raw transcript on the intent so the UI can show what was heard', () => {
    expect(parseVoiceCommand('Start Tracking Deen').transcript).toBe('Start Tracking Deen')
    expect(parseVoiceCommand('wibble wobble').transcript).toBe('wibble wobble')
  })

  it('takes a name with no kind word as unspecified rather than guessing', () => {
    expect(targetOf('start tracking deen')).toEqual({ kind: 'unspecified', name: 'deen' })
  })

  it('reads a kind word in front of the name too', () => {
    expect(targetOf('start tracking the task invoices')).toEqual({ kind: 'task', name: 'invoices' })
  })

  it('treats a lone kind word as naming nothing', () => {
    // "which goal?" is the honest answer here, not a timer on a goal called
    // "goal".
    expect(targetOf('start tracking my goal')).toBeNull()
  })

  it('does not let a trailing time qualifier become a name', () => {
    expect(targetOf('pause for a moment')).toBeNull()
    expect(targetOf('stop now')).toBeNull()
  })

  it('keeps a real name that merely contains a noise word', () => {
    expect(targetOf('start tracking my time management goal')).toEqual({
      kind: 'goal',
      name: 'time management',
    })
  })
})

describe('parseVoiceCommand — "start tracking time for my work for X"', () => {
  // The reported bug, verbatim: this asked for a timer on a goal called
  // OloStep and produced a set of proposed edits to the schedule instead.
  // The parse was already START_TRACKING; what broke was the name, which
  // came out as "work for olostep" and matched the real goal too weakly for
  // the tracker to act on, so the sentence went to the Coach — which is
  // under standing instructions to offer to link unlinked schedule blocks to
  // a goal, and duly offered exactly that.
  it('names the goal, not the work being done on it', () => {
    const said = 'start tracking time for my work for Olostep'
    expect(parseVoiceCommand(said).type).toBe('START_TRACKING')
    expect(targetOf(said)).toEqual({ kind: 'unspecified', name: 'olostep' })
  })

  it('reads the same request phrased as a polite question', () => {
    const said = 'Can you start tracking time for my work for Olostep?'
    expect(parseVoiceCommand(said).type).toBe('START_TRACKING')
    expect(targetOf(said)).toEqual({ kind: 'unspecified', name: 'olostep' })
  })

  it.each([
    ['start tracking my work on olostep', 'olostep'],
    ['start working on my work for olostep', 'olostep'],
    ['begin tracking time for my work for olo step', 'olo step'],
    ['track time for my work for olostep', 'olostep'],
    ['start tracking time for my work for the olostep goal', 'olostep'],
  ])('%s names %s', (transcript, name) => {
    expect(parseVoiceCommand(transcript).type).toBe('START_TRACKING')
    expect(targetOf(transcript)?.name).toBe(name)
  })

  it('keeps a goal genuinely called Work when nothing is named after it', () => {
    // The word is only ever given up to a name behind a connective. A user
    // whose goal is literally "Work" still gets their timer.
    expect(targetOf('start tracking my work')).toEqual({ kind: 'unspecified', name: 'work' })
    expect(targetOf('start tracking my work now')).toEqual({ kind: 'unspecified', name: 'work' })
    expect(targetOf('start tracking my work for now')).toEqual({ kind: 'unspecified', name: 'work' })
    expect(targetOf('start tracking the work goal')).toEqual({ kind: 'goal', name: 'work' })
  })

  it('does not eat a name that merely begins with the word', () => {
    expect(targetOf('start tracking my work trip planning')).toEqual({
      kind: 'unspecified',
      name: 'work trip planning',
    })
  })
})

describe('parseVoiceCommand — what it refuses', () => {
  it('never reads cancel as a stop', () => {
    // The two sit next to each other in a user's head and mean opposite
    // things to a running session: one banks the time, the other throws it
    // away.
    expect(parseVoiceCommand('cancel').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('cancel the timer').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('discard this session').type).toBe('UNKNOWN')
  })

  it('does not promote a log with no duration into a start', () => {
    expect(parseVoiceCommand('log time for my deen goal').type).toBe('UNKNOWN')
  })

  it('reads a question as nothing, even when it contains a command verb', () => {
    expect(parseVoiceCommand('what did I work on yesterday').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('how long have I been tracking').type).toBe('UNKNOWN')
  })

  it('leaves an open-ended assistant request for the Coach', () => {
    // Anything not in the tracking vocabulary has to fall through, or the
    // fast path starts silently swallowing commands it cannot perform.
    expect(parseVoiceCommand('move my study block to 7pm').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('add a task to call the bank').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('rename my fitness goal to health').type).toBe('UNKNOWN')
  })

  it('returns UNKNOWN for silence', () => {
    expect(parseVoiceCommand('').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('   ').type).toBe('UNKNOWN')
  })

  it('parses a two-command sentence as the first one only', () => {
    expect(parseVoiceCommand('stop and then start tracking fitness').type).toBe('STOP_TRACKING')
  })

  it('drops anything under an explicit confidence floor', () => {
    // "done" is a real stop and also something people mutter. A caller that
    // cannot afford the guess raises the floor rather than editing the rules.
    expect(parseVoiceCommand('done').type).toBe('STOP_TRACKING')
    expect(parseVoiceCommand('done', { minConfidence: 0.8 }).type).toBe('UNKNOWN')
  })
})

describe('parseVoiceCommand — confidence', () => {
  it('scores a bare exact command higher than a hedged one', () => {
    const exact = parseVoiceCommand('stop tracking')
    const weak = parseVoiceCommand('done')
    expect(exact.confidence).toBeGreaterThan(weak.confidence)
  })

  it('discounts a command sitting behind words it could not account for', () => {
    const clean = parseVoiceCommand('start tracking deen')
    const buried = parseVoiceCommand('right then lets see start tracking deen')
    expect(buried.confidence).toBeLessThanOrEqual(clean.confidence)
  })

  it('always reports a number between 0 and 1', () => {
    for (const said of ['start', 'done', 'log 30 to deen', 'nonsense words here', '']) {
      const { confidence } = parseVoiceCommand(said)
      expect(confidence).toBeGreaterThanOrEqual(0)
      expect(confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('parseVoiceCommand — LOG_TIME', () => {
  it('reads a duration and a target', () => {
    const intent = parseVoiceCommand('log 30 minutes to deen')
    expect(intent.type).toBe('LOG_TIME')
    if (intent.type !== 'LOG_TIME') throw new Error('unreachable')
    expect(intent.durationMinutes).toBe(30)
    expect(isNamedTarget(intent.target) && intent.target.name).toBe('deen')
  })

  it.each([
    ['log 30 minutes to deen', 30],
    ['log 1 hour to deen', 60],
    ['i spent an hour and a half on deen', 90],
    ['log half an hour to deen', 30],
    ['log 90 seconds to deen', 1.5],
    ['log 1 hour 30 minutes to deen', 90],
  ])('%s reads as %s minutes', (transcript, minutes) => {
    const intent = parseVoiceCommand(transcript)
    if (intent.type !== 'LOG_TIME') throw new Error(`expected LOG_TIME, got ${intent.type}`)
    expect(intent.durationMinutes).toBeCloseTo(minutes, 5)
  })

  it('penalises a bare number whose unit had to be assumed', () => {
    const assumed = parseVoiceCommand('log 30 to deen')
    const explicit = parseVoiceCommand('log 30 minutes to deen')
    expect(assumed.type).toBe('LOG_TIME')
    expect(assumed.confidence).toBeLessThan(explicit.confidence)
  })

  it('does not read a number inside a name as a duration', () => {
    const intent = parseVoiceCommand('start tracking sprint 3')
    expect(intent.type).toBe('START_TRACKING')
    expect(targetOf('start tracking sprint 3')).toEqual({ kind: 'unspecified', name: 'sprint 3' })
  })
})

describe('parseVoiceCommand — APPEND_NOTE', () => {
  it('reads the reported use case: "add X to my Y notes"', () => {
    const intent = parseVoiceCommand('add milk to my shopping notes')
    expect(intent.type).toBe('APPEND_NOTE')
    if (intent.type !== 'APPEND_NOTE') throw new Error('unreachable')
    expect(intent.content).toBe('milk')
    expect(isNamedTarget(intent.target) && intent.target).toEqual({ kind: 'note', name: 'shopping' })
  })

  // The key disambiguator: without an explicit note-kind word ("notes" /
  // "note" / "page" / "pages") at the end of the named target, this must
  // not fire at all — the exact same sentence shape is also how someone
  // asks the Coach to create a task or rename a goal.
  it('requires an explicit note-kind word to fire, and never matches without one', () => {
    expect(parseVoiceCommand('add milk to my shopping').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('add a task to call the bank').type).toBe('UNKNOWN')
    expect(parseVoiceCommand('rename my fitness goal to health').type).toBe('UNKNOWN')
  })

  it.each(['note', 'notes', 'page', 'pages'])('recognises "%s" as the note-kind word', (kindWord) => {
    const intent = parseVoiceCommand(`add milk to my shopping ${kindWord}`)
    expect(intent.type).toBe('APPEND_NOTE')
    if (intent.type !== 'APPEND_NOTE') throw new Error('unreachable')
    expect(isNamedTarget(intent.target) && intent.target.kind).toBe('note')
  })

  it('keeps a "to" that sits inside the content itself, splitting on the LAST connective instead', () => {
    const intent = parseVoiceCommand('add call mom back to my errands notes')
    expect(intent.type).toBe('APPEND_NOTE')
    if (intent.type !== 'APPEND_NOTE') throw new Error('unreachable')
    expect(intent.content).toBe('call mom back')
    expect(isNamedTarget(intent.target) && intent.target.name).toBe('errands')
  })

  it('rejects as UNKNOWN when there is a valid page but nothing to add', () => {
    expect(parseVoiceCommand('add to my shopping notes').type).toBe('UNKNOWN')
  })

  it('keeps the content in its original casing and punctuation, not folded', () => {
    const intent = parseVoiceCommand("Add Buy Qur'an, size Medium! to my Shopping notes")
    expect(intent.type).toBe('APPEND_NOTE')
    if (intent.type !== 'APPEND_NOTE') throw new Error('unreachable')
    expect(intent.content).toBe("Buy Qur'an, size Medium!")
  })

  it('reads other verb phrasings the same way', () => {
    expect(parseVoiceCommand('append buy eggs to my groceries notes').type).toBe('APPEND_NOTE')
    expect(parseVoiceCommand('note buy eggs in my journal notes').type).toBe('APPEND_NOTE')
    expect(parseVoiceCommand('put buy eggs in my groceries notes').type).toBe('APPEND_NOTE')
  })

  it('is not reversible — it writes into a page nobody has reviewed, same as LOG_TIME', () => {
    expect(isReversibleVoiceIntent(parseVoiceCommand('add milk to my shopping notes'))).toBe(false)
  })
})

describe('findSpokenDuration', () => {
  it('reports the token span it consumed so the caller can lift it out', () => {
    expect(findSpokenDuration(['30', 'minutes', 'to', 'deen'])).toEqual({
      minutes: 30,
      start: 0,
      end: 2,
      assumedUnit: false,
    })
  })

  it('finds nothing in a run with no quantity', () => {
    expect(findSpokenDuration(['to', 'deen'])).toBeNull()
  })
})

describe('describeVoiceIntent', () => {
  it('renders a line a confirmation prompt can show', () => {
    expect(describeVoiceIntent(parseVoiceCommand('start tracking deen'))).toBe('Start tracking deen')
    expect(describeVoiceIntent(parseVoiceCommand('log 30 minutes to deen'))).toBe('Log 30 min to deen')
    expect(describeVoiceIntent(parseVoiceCommand('stop'))).toBe('Stop tracking')
    expect(describeVoiceIntent(parseVoiceCommand('nonsense'))).toBe('Unknown command')
  })

  it('prefers a resolved record name over the words that were said', () => {
    // "dean" was heard; "Deen" is what it resolved to, and the confirmation
    // has to name the real record or it is confirming the wrong thing.
    expect(describeVoiceIntent(parseVoiceCommand('start tracking dean'), 'Deen')).toBe('Start tracking Deen')
  })
})
