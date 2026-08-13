import { describe, expect, it } from 'vitest'

import { buildDayAnalysisBundle, formatDayAnalysisPrompt } from './day-analysis'

// Wednesday, 2026-08-12 (dayOfWeek === 3), so weekly-trailing lookups land on
// 2026-08-05, 2026-07-29, 2026-07-22, 2026-07-15.
const DATE_KEY = '2026-08-12'
const NOW = new Date(2026, 7, 12, 20, 0, 0)

describe('buildDayAnalysisBundle', () => {
  it('labels today/yesterday and marks a block completed when a matching entry exists', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [
        { id: 'block-1', title: 'Deep Work', category: 'WORK', dayOfWeek: 3, startTime: '09:00', endTime: '10:30', goalId: 'goal-1', goalTitle: 'Ampwise' },
      ],
      timeEntriesForDay: [
        { id: 'e1', taskName: 'Ampwise dev', duration: 60, date: DATE_KEY, scheduleBlockId: 'block-1', goalId: 'goal-1', goalTitle: 'Ampwise' },
      ],
      trailingTimeEntries: [],
      trailingWindowDays: 14,
      journalContent: null,
    })

    expect(bundle.dateLabel).toBe('today')
    expect(bundle.blocks).toHaveLength(1)
    expect(bundle.blocks[0]!.completed).toBe(true)
    expect(bundle.blocks[0]!.trackedMinutes).toBe(60)
    expect(bundle.completedBlockCount).toBe(1)
    expect(bundle.totalBlockCount).toBe(1)
  })

  it('marks a block not completed when no time entry links to it', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [
        { id: 'block-1', title: 'Morning Run', category: 'HEALTH', dayOfWeek: 3, startTime: '06:00', endTime: '06:30' },
      ],
      timeEntriesForDay: [],
      trailingTimeEntries: [],
      trailingWindowDays: 14,
      journalContent: null,
    })

    expect(bundle.blocks[0]!.completed).toBe(false)
    expect(bundle.completedBlockCount).toBe(0)
    expect(bundle.patterns).toContain('None of today\'s 1 scheduled block were completed.')
  })

  it('computes a block completion-history pattern from trailing weekly occurrences', () => {
    // Block was completed on 2 of the 4 prior Wednesdays.
    const trailingTimeEntries = [
      { id: 't1', taskName: 'x', duration: 30, date: '2026-08-05', scheduleBlockId: 'block-1' },
      { id: 't2', taskName: 'x', duration: 30, date: '2026-07-22', scheduleBlockId: 'block-1' },
    ]
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [
        { id: 'block-1', title: "Qur'an Reading", category: 'SPIRITUAL', dayOfWeek: 3, startTime: '06:00', endTime: '06:30' },
      ],
      timeEntriesForDay: [],
      trailingTimeEntries,
      trailingWindowDays: 28,
      journalContent: null,
    })

    expect(bundle.blocks[0]!.completionHistory).toBe('completed 2 of the last 4 Wednesdays')
    expect(bundle.patterns.some((p) => p.includes('rarely completed'))).toBe(true)
  })

  it('does not flag a healthy completion history as a "rarely completed" pattern', () => {
    const trailingTimeEntries = [
      { id: 't1', taskName: 'x', duration: 30, date: '2026-08-05', scheduleBlockId: 'block-1' },
      { id: 't2', taskName: 'x', duration: 30, date: '2026-07-29', scheduleBlockId: 'block-1' },
      { id: 't3', taskName: 'x', duration: 30, date: '2026-07-22', scheduleBlockId: 'block-1' },
    ]
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [
        { id: 'block-1', title: 'Deep Work', category: 'WORK', dayOfWeek: 3, startTime: '09:00', endTime: '10:30' },
      ],
      timeEntriesForDay: [{ id: 'e1', taskName: 'x', duration: 60, date: DATE_KEY, scheduleBlockId: 'block-1' }],
      trailingTimeEntries,
      trailingWindowDays: 28,
      journalContent: null,
    })

    expect(bundle.blocks[0]!.completionHistory).toBe('completed 3 of the last 4 Wednesdays')
    expect(bundle.patterns.some((p) => p.includes('rarely completed'))).toBe(false)
  })

  it('flags a goal getting well above its recent daily average', () => {
    const trailingTimeEntries = Array.from({ length: 7 }, (_, i) => ({
      id: `t${i}`,
      taskName: 'x',
      duration: 15,
      date: `2026-08-0${i + 1}`,
      goalId: 'goal-1',
      goalTitle: 'Ampwise',
    })) // 7 * 15 = 105 minutes over a 14-day window => avg 7.5/day

    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [],
      timeEntriesForDay: [
        { id: 'today1', taskName: 'Ampwise sprint', duration: 90, date: DATE_KEY, goalId: 'goal-1', goalTitle: 'Ampwise' },
      ],
      trailingTimeEntries,
      trailingWindowDays: 14,
      journalContent: null,
    })

    expect(bundle.goalBreakdown).toHaveLength(1)
    expect(bundle.goalBreakdown[0]!.comparisonLabel).toBe('well above usual')
    expect(bundle.patterns.some((p) => p.includes('Ampwise') && p.includes('well above'))).toBe(true)
  })

  it('reports "no recent baseline" when a goal has no trailing history', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [],
      timeEntriesForDay: [
        { id: 'today1', taskName: 'New thing', duration: 30, date: DATE_KEY, goalId: 'goal-2', goalTitle: 'New Goal' },
      ],
      trailingTimeEntries: [],
      trailingWindowDays: 14,
      journalContent: null,
    })

    expect(bundle.goalBreakdown[0]!.comparisonLabel).toBe('no recent baseline')
  })

  it('separates unscheduled entries from block-linked ones', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [
        { id: 'block-1', title: 'Deep Work', category: 'WORK', dayOfWeek: 3, startTime: '09:00', endTime: '10:30' },
      ],
      timeEntriesForDay: [
        { id: 'e1', taskName: 'Ampwise dev', duration: 60, date: DATE_KEY, scheduleBlockId: 'block-1' },
        { id: 'e2', taskName: 'Random errand', duration: 20, date: DATE_KEY },
      ],
      trailingTimeEntries: [],
      trailingWindowDays: 14,
      journalContent: null,
    })

    expect(bundle.unscheduledEntries).toHaveLength(1)
    expect(bundle.unscheduledEntries[0]!.id).toBe('e2')
    expect(bundle.totalTrackedMinutes).toBe(80)
    expect(bundle.patterns.some((p) => p.includes('logged outside any scheduled block'))).toBe(true)
  })

  it('carries the journal entry through untouched', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [],
      timeEntriesForDay: [],
      trailingTimeEntries: [],
      trailingWindowDays: 14,
      journalContent: '  Felt scattered this morning.  ',
    })

    expect(bundle.journalContent).toBe('  Felt scattered this morning.  ')
  })
})

describe('formatDayAnalysisPrompt', () => {
  it('renders a complete, readable prompt with all sections present', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [
        { id: 'block-1', title: 'Deep Work', category: 'WORK', dayOfWeek: 3, startTime: '09:00', endTime: '10:30', goalId: 'goal-1', goalTitle: 'Ampwise' },
        { id: 'block-2', title: "Qur'an Reading", category: 'SPIRITUAL', dayOfWeek: 3, startTime: '06:00', endTime: '06:30' },
      ],
      timeEntriesForDay: [
        { id: 'e1', taskName: 'Ampwise sprint', duration: 90, date: DATE_KEY, scheduleBlockId: 'block-1', goalId: 'goal-1', goalTitle: 'Ampwise' },
        { id: 'e2', taskName: 'Errand', duration: 15, date: DATE_KEY },
      ],
      trailingTimeEntries: [
        { id: 't1', taskName: 'x', duration: 30, date: '2026-08-05', scheduleBlockId: 'block-2' },
      ],
      trailingWindowDays: 14,
      journalContent: 'Long day but Deep Work felt great.',
    })

    const prompt = formatDayAnalysisPrompt(bundle)
    expect(prompt).toContain('Analyze my day (Today).')
    expect(prompt).toContain('Deep Work')
    expect(prompt).toContain('not completed')
    expect(prompt).toContain('Unscheduled time logged today')
    expect(prompt).toContain('Errand')
    expect(prompt).toContain('Time by goal today vs. recent daily average')
    expect(prompt).toContain("Today's journal entry:")
    expect(prompt).toContain('Long day but Deep Work felt great.')
    expect(prompt).toContain('Please reflect on how my day went')
  })

  it('handles an empty day gracefully (no blocks, no entries, no journal)', () => {
    const bundle = buildDayAnalysisBundle({
      dateKey: DATE_KEY,
      now: NOW,
      scheduleBlocksForDay: [],
      timeEntriesForDay: [],
      trailingTimeEntries: [],
      trailingWindowDays: 14,
      journalContent: null,
    })

    const prompt = formatDayAnalysisPrompt(bundle)
    expect(prompt).toContain('none scheduled this day')
    expect(prompt).toContain('No journal entry written for today.')
    expect(prompt).not.toContain('undefined')
  })
})
