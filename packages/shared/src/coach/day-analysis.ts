// New: assembles a single day's full picture — scheduled blocks (completed
// vs not), time tracked by goal/task, and the journal entry for that day —
// into one prompt-ready bundle for the Coach.
//
// Why this lives client-side rather than as a backend change: the Coach's
// system prompt and the per-request context bundle it reasons over both live
// in the sibling goal-slot-api repo (see coach-ai.service.ts's
// buildContextBundle/buildUserContextMessage), not in this repo. That bundle
// already includes the last 14 days of journal entries and time entries, but
// two things a real "how was my day" answer needs are missing from it:
//   1. Per-day schedule-block completion. `scheduleBlocks` in that bundle
//      carries the recurring block definitions (id/title/day/time/category)
//      with no notion of "did this happen today" — there's no completed
//      flag on the model, and completion isn't computed anywhere server-side.
//   2. Any explicit "this is unusual" framing — the backend context is raw
//      data (JSON blobs + plain-text lists); pattern-spotting is left
//      entirely to the LLM's own read of 80 rows of time entries.
// Rather than guess at a backend change this checkout can't make (and can't
// verify — no server, no DB), this module computes both client-side, using
// data this app already fetches (schedule, time entries, journal), and folds
// the result into the *text of a chat message* sent through the existing
// POST /coach/chat/:scopeKey path — no API contract change required. See
// apps/mobile/app/(app)/coach.tsx for the "Analyze my day" quick action that
// calls this.
//
// Completion, defined: a schedule block is "completed" for a given day when
// at least one time entry for that day carries `scheduleBlockId` equal to
// the block's id. That's the same link the app already writes when a timer
// is started from a block or a manual entry is logged against one (see
// active-timer.ts's scheduleBlockId, ScheduleBlockSheet.tsx) — this module
// doesn't invent a new relationship, just reads the existing one.

import { DAYS_OF_WEEK_FULL, formatDuration, formatTime12h } from '../scheduling/time'

export interface DayAnalysisScheduleBlockInput {
  id: string
  title: string
  category: string
  dayOfWeek: number
  startTime: string
  endTime: string
  goalId?: string
  goalTitle?: string
}

export interface DayAnalysisTimeEntryInput {
  id: string
  taskName: string
  /** Minutes. */
  duration: number
  /** YYYY-MM-DD, local. */
  date: string
  scheduleBlockId?: string
  goalId?: string
  goalTitle?: string
}

export interface BuildDayAnalysisInput {
  /** The day being analyzed, YYYY-MM-DD local. */
  dateKey: string
  /** Defaults to `new Date()` — only overridden by tests for deterministic "today"/"yesterday" labeling. */
  now?: Date
  /** This day's scheduled blocks (already filtered to `dayOfWeek === new Date(dateKey).getDay()`). */
  scheduleBlocksForDay: DayAnalysisScheduleBlockInput[]
  /** Time entries logged on `dateKey`. */
  timeEntriesForDay: DayAnalysisTimeEntryInput[]
  /**
   * Time entries from a trailing lookback window BEFORE `dateKey` (never
   * including it) — used only to compute "is this unusual" comparisons:
   * per-block completion history and per-goal daily averages. A wider
   * window gives sturdier patterns but costs more tokens; callers choose
   * the range (the mobile quick action uses 28 days).
   */
  trailingTimeEntries: DayAnalysisTimeEntryInput[]
  /** How many days `trailingTimeEntries` actually spans — needed to turn a trailing total into a daily average. Must be > 0 for goal-average comparisons to be produced. */
  trailingWindowDays: number
  /** This day's journal entry text, or null/undefined if none was written. */
  journalContent?: string | null
  /**
   * How many past same-weekday occurrences to look back across
   * `trailingTimeEntries` when judging a block's completion pattern.
   * Default 4 (roughly a month for a weekly-recurring block).
   */
  lookbackOccurrences?: number
}

export interface DayAnalysisBlockResult {
  id: string
  title: string
  category: string
  startTime: string
  endTime: string
  goalId?: string
  goalTitle?: string
  trackedMinutes: number
  completed: boolean
  /** e.g. "completed 1 of the last 4 Wednesdays" — omitted when there's no trailing history to compare against. */
  completionHistory?: string
}

export interface DayAnalysisGoalResult {
  goalId: string
  title: string
  minutesToday: number
  /** Average daily minutes logged toward this goal over the trailing window (excluding the analyzed day). */
  trailingDailyAverageMinutes: number
  comparisonLabel: 'well above usual' | 'above usual' | 'about typical' | 'below usual' | 'well below usual' | 'no recent baseline'
}

export interface DayAnalysisBundle {
  dateKey: string
  /** "today", "yesterday", or "Wednesday, August 13" — for prompt phrasing. */
  dateLabel: string
  dayOfWeekLabel: string
  blocks: DayAnalysisBlockResult[]
  /** Entries logged today that aren't linked to any of today's scheduled blocks — ad hoc / unscheduled work. */
  unscheduledEntries: DayAnalysisTimeEntryInput[]
  goalBreakdown: DayAnalysisGoalResult[]
  totalTrackedMinutes: number
  completedBlockCount: number
  totalBlockCount: number
  journalContent: string | null
  /** Extra human-readable notable-pattern lines, beyond what's implied by the per-block/per-goal fields above. */
  patterns: string[]
}

function parseLocalDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function subtractDaysKey(dateKey: string, days: number): string {
  const d = parseLocalDateKey(dateKey)
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function formatDateLabel(dateKey: string, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = parseLocalDateKey(dateKey)
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  return target.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function compareToAverage(
  minutesToday: number,
  trailingDailyAverageMinutes: number,
): DayAnalysisGoalResult['comparisonLabel'] {
  if (trailingDailyAverageMinutes <= 0) return 'no recent baseline'
  const ratio = minutesToday / trailingDailyAverageMinutes
  if (ratio >= 1.75) return 'well above usual'
  if (ratio >= 1.2) return 'above usual'
  if (ratio <= 0.25) return 'well below usual'
  if (ratio <= 0.8) return 'below usual'
  return 'about typical'
}

/**
 * Assemble one day's schedule + tracked time + journal entry into a single
 * bundle, with lightweight pattern detection (block completion history,
 * goal-time deviation from the recent daily average) computed against the
 * supplied trailing window. Pure function — every input is data the caller
 * already fetched, nothing here talks to the network.
 */
export function buildDayAnalysisBundle(input: BuildDayAnalysisInput): DayAnalysisBundle {
  const now = input.now ?? new Date()
  const lookbackOccurrences = input.lookbackOccurrences ?? 4

  const entriesByBlockId = new Map<string, DayAnalysisTimeEntryInput[]>()
  for (const entry of input.timeEntriesForDay) {
    if (!entry.scheduleBlockId) continue
    const list = entriesByBlockId.get(entry.scheduleBlockId) ?? []
    list.push(entry)
    entriesByBlockId.set(entry.scheduleBlockId, list)
  }

  // Index trailing entries by scheduleBlockId -> set of dates they landed on,
  // so block completion history is a date lookup rather than a re-scan per block.
  const trailingDatesByBlockId = new Map<string, Set<string>>()
  for (const entry of input.trailingTimeEntries) {
    if (!entry.scheduleBlockId) continue
    const set = trailingDatesByBlockId.get(entry.scheduleBlockId) ?? new Set<string>()
    set.add(entry.date)
    trailingDatesByBlockId.set(entry.scheduleBlockId, set)
  }

  const blocks: DayAnalysisBlockResult[] = input.scheduleBlocksForDay.map((block) => {
    const linkedEntries = entriesByBlockId.get(block.id) ?? []
    const trackedMinutes = linkedEntries.reduce((sum, e) => sum + e.duration, 0)
    const completed = trackedMinutes > 0

    let completionHistory: string | undefined
    const trailingDates = trailingDatesByBlockId.get(block.id)
    if (trailingDates) {
      let occurrences = 0
      let completedOccurrences = 0
      for (let weeksBack = 1; weeksBack <= lookbackOccurrences; weeksBack++) {
        const pastDateKey = subtractDaysKey(input.dateKey, weeksBack * 7)
        occurrences++
        if (trailingDates.has(pastDateKey)) completedOccurrences++
      }
      if (occurrences > 0) {
        const dayName = DAYS_OF_WEEK_FULL[block.dayOfWeek] ?? 'that day'
        completionHistory = `completed ${completedOccurrences} of the last ${occurrences} ${dayName}s`
      }
    }

    return {
      id: block.id,
      title: block.title,
      category: block.category,
      startTime: block.startTime,
      endTime: block.endTime,
      goalId: block.goalId,
      goalTitle: block.goalTitle,
      trackedMinutes,
      completed,
      completionHistory,
    }
  })

  const scheduledBlockIds = new Set(input.scheduleBlocksForDay.map((b) => b.id))
  const unscheduledEntries = input.timeEntriesForDay.filter(
    (e) => !e.scheduleBlockId || !scheduledBlockIds.has(e.scheduleBlockId),
  )

  // Goal breakdown: today's minutes per goal vs. the trailing daily average
  // for that same goal. Only goals with time logged today are surfaced —
  // this is a "how did today compare" view, not a full goal roster.
  const todayMinutesByGoal = new Map<string, { title: string; minutes: number }>()
  for (const entry of input.timeEntriesForDay) {
    if (!entry.goalId) continue
    const existing = todayMinutesByGoal.get(entry.goalId)
    const title = entry.goalTitle ?? existing?.title ?? 'Untitled goal'
    todayMinutesByGoal.set(entry.goalId, { title, minutes: (existing?.minutes ?? 0) + entry.duration })
  }

  const trailingMinutesByGoal = new Map<string, number>()
  for (const entry of input.trailingTimeEntries) {
    if (!entry.goalId) continue
    trailingMinutesByGoal.set(entry.goalId, (trailingMinutesByGoal.get(entry.goalId) ?? 0) + entry.duration)
  }

  const goalBreakdown: DayAnalysisGoalResult[] = Array.from(todayMinutesByGoal.entries()).map(
    ([goalId, { title, minutes }]) => {
      const trailingTotal = trailingMinutesByGoal.get(goalId) ?? 0
      const trailingDailyAverageMinutes =
        input.trailingWindowDays > 0 ? trailingTotal / input.trailingWindowDays : 0
      return {
        goalId,
        title,
        minutesToday: minutes,
        trailingDailyAverageMinutes,
        comparisonLabel: compareToAverage(minutes, trailingDailyAverageMinutes),
      }
    },
  )
  goalBreakdown.sort((a, b) => b.minutesToday - a.minutesToday)

  const totalTrackedMinutes = input.timeEntriesForDay.reduce((sum, e) => sum + e.duration, 0)
  const completedBlockCount = blocks.filter((b) => b.completed).length
  const totalBlockCount = blocks.length

  const patterns: string[] = []

  // Low-completion blocks: worth naming even though the raw ratio is also on
  // the block itself, because this is the "notice a pattern" surface the
  // Coach's prose should lead with, not just restate the day's own numbers.
  for (const block of blocks) {
    if (!block.completionHistory) continue
    const match = /completed (\d+) of the last (\d+)/.exec(block.completionHistory)
    if (!match) continue
    const completedCount = Number(match[1])
    const total = Number(match[2])
    if (total >= 2 && completedCount / total <= 0.5) {
      patterns.push(
        `"${block.title}" is rarely completed: ${block.completionHistory}${block.completed ? ' (though it was completed today)' : ''}.`,
      )
    }
  }

  if (totalBlockCount > 0 && completedBlockCount === 0) {
    patterns.push(`None of today's ${totalBlockCount} scheduled block${totalBlockCount === 1 ? '' : 's'} were completed.`)
  } else if (totalBlockCount > 0 && completedBlockCount === totalBlockCount) {
    patterns.push(`Every scheduled block today was completed (${completedBlockCount}/${totalBlockCount}).`)
  }

  for (const g of goalBreakdown) {
    if (g.comparisonLabel === 'well above usual' || g.comparisonLabel === 'well below usual') {
      const direction = g.comparisonLabel === 'well above usual' ? 'well above' : 'well below'
      patterns.push(
        `"${g.title}" got ${formatDuration(g.minutesToday)} today, ${direction} its recent daily average of ${formatDuration(Math.round(g.trailingDailyAverageMinutes))}.`,
      )
    }
  }

  if (unscheduledEntries.length > 0) {
    const unscheduledMinutes = unscheduledEntries.reduce((sum, e) => sum + e.duration, 0)
    patterns.push(
      `${formatDuration(unscheduledMinutes)} was logged outside any scheduled block (${unscheduledEntries.length} entr${unscheduledEntries.length === 1 ? 'y' : 'ies'}).`,
    )
  }

  return {
    dateKey: input.dateKey,
    dateLabel: formatDateLabel(input.dateKey, now),
    dayOfWeekLabel: DAYS_OF_WEEK_FULL[parseLocalDateKey(input.dateKey).getDay()] ?? '',
    blocks,
    unscheduledEntries,
    goalBreakdown,
    totalTrackedMinutes,
    completedBlockCount,
    totalBlockCount,
    journalContent: input.journalContent ?? null,
    patterns,
  }
}

/**
 * Render a `DayAnalysisBundle` as a well-formed chat message the mobile
 * Coach screen's "Analyze my day" action posts through the existing
 * `apiClient.coach.streamChat`. Plain, readable prose+lists rather than a
 * JSON dump — this text becomes the USER turn's persisted content, so it's
 * also what renders in the chat bubble history, not a hidden side-channel.
 */
export function formatDayAnalysisPrompt(bundle: DayAnalysisBundle): string {
  const lines: string[] = []
  const capitalizedLabel = bundle.dateLabel === 'today' || bundle.dateLabel === 'yesterday'
    ? bundle.dateLabel.charAt(0).toUpperCase() + bundle.dateLabel.slice(1)
    : bundle.dateLabel

  lines.push(`Analyze my day (${capitalizedLabel}).`)
  lines.push('')

  if (bundle.totalBlockCount === 0) {
    lines.push('Scheduled blocks: none scheduled this day.')
  } else {
    lines.push(`Scheduled blocks (${bundle.completedBlockCount}/${bundle.totalBlockCount} completed):`)
    for (const block of bundle.blocks) {
      const status = block.completed ? `completed, ${formatDuration(block.trackedMinutes)} tracked` : 'not completed'
      const goalPart = block.goalTitle ? `, goal "${block.goalTitle}"` : ''
      const historyPart = block.completionHistory ? ` [history: ${block.completionHistory}]` : ''
      lines.push(
        `- ${formatTime12h(block.startTime)} to ${formatTime12h(block.endTime)} "${block.title}" (${block.category}${goalPart}) — ${status}${historyPart}`,
      )
    }
  }
  lines.push('')

  if (bundle.unscheduledEntries.length > 0) {
    lines.push('Unscheduled time logged today:')
    for (const entry of bundle.unscheduledEntries) {
      const goalPart = entry.goalTitle ? `, goal "${entry.goalTitle}"` : ''
      lines.push(`- ${formatDuration(entry.duration)} "${entry.taskName}"${goalPart}`)
    }
    lines.push('')
  }

  lines.push(`Total tracked today: ${formatDuration(bundle.totalTrackedMinutes)}.`)
  lines.push('')

  if (bundle.goalBreakdown.length > 0) {
    lines.push('Time by goal today vs. recent daily average:')
    for (const g of bundle.goalBreakdown) {
      lines.push(
        `- "${g.title}": ${formatDuration(g.minutesToday)} today, avg ${formatDuration(Math.round(g.trailingDailyAverageMinutes))}/day recently (${g.comparisonLabel}).`,
      )
    }
    lines.push('')
  }

  if (bundle.patterns.length > 0) {
    lines.push('Notable patterns I noticed:')
    for (const p of bundle.patterns) lines.push(`- ${p}`)
    lines.push('')
  }

  if (bundle.journalContent && bundle.journalContent.trim().length > 0) {
    lines.push("Today's journal entry:")
    lines.push(`"${bundle.journalContent.trim()}"`)
    lines.push('')
  } else {
    lines.push('No journal entry written for today.')
    lines.push('')
  }

  lines.push(
    'Please reflect on how my day went: call out what worked, what did not, and connect it to the patterns above and the journal entry if there is one. Do not just restate the numbers back to me.',
  )

  return lines.join('\n')
}
