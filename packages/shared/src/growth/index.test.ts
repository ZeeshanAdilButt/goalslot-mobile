import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConsoleAnalytics, createStaticFeatureFlags } from './index'

describe('createConsoleAnalytics', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('logs track() calls with the event name and payload', () => {
    const analytics = createConsoleAnalytics()
    analytics.track({ name: 'goalCreated', payload: { goalId: 'g1' } })
    expect(logSpy).toHaveBeenCalledWith('[analytics] goalCreated', { goalId: 'g1' })
  })

  it('logs identify() calls with the user id', () => {
    const analytics = createConsoleAnalytics()
    analytics.identify('u1')
    expect(logSpy).toHaveBeenCalledWith('[analytics] identify', 'u1')
  })

  it('logs reset() calls', () => {
    const analytics = createConsoleAnalytics()
    analytics.reset()
    expect(logSpy).toHaveBeenCalledWith('[analytics] reset')
  })

  it('accepts every event in the v1 event surface without throwing', () => {
    const analytics = createConsoleAnalytics()
    expect(() => {
      analytics.track({ name: 'goalCreated', payload: { goalId: 'g1' } })
      analytics.track({ name: 'goalCompleted', payload: { goalId: 'g1' } })
      analytics.track({ name: 'goalDeleted', payload: { goalId: 'g1' } })
      analytics.track({ name: 'taskCreated', payload: { taskId: 't1' } })
      analytics.track({ name: 'taskCompleted', payload: { taskId: 't1' } })
      analytics.track({ name: 'taskDeleted', payload: { taskId: 't1' } })
      analytics.track({ name: 'scheduleBlockCreated', payload: { scheduleBlockId: 's1' } })
      analytics.track({ name: 'scheduleBlockUpdated', payload: { scheduleBlockId: 's1' } })
      analytics.track({ name: 'scheduleBlockDeleted', payload: { scheduleBlockId: 's1' } })
      analytics.track({ name: 'timerStarted', payload: { taskId: 't1' } })
      analytics.track({ name: 'timerStopped', payload: { taskId: 't1', durationSeconds: 60 } })
      analytics.track({ name: 'timerPaused', payload: { taskId: 't1' } })
      analytics.track({ name: 'quickAddOpened', payload: { kind: 'goal' } })
      analytics.track({ name: 'screenViewed', payload: { screenName: 'Today' } })
      analytics.track({ name: 'journalEntrySaved', payload: { date: '2026-08-08' } })
    }).not.toThrow()
  })
})

describe('createStaticFeatureFlags', () => {
  it('defaults every known flag to off', () => {
    const flags = createStaticFeatureFlags()
    expect(flags.isEnabled('voiceAssistant')).toBe(false)
    expect(flags.isEnabled('realAlarms')).toBe(false)
  })

  it('honors explicit overrides', () => {
    const flags = createStaticFeatureFlags({ voiceAssistant: true })
    expect(flags.isEnabled('voiceAssistant')).toBe(true)
    expect(flags.isEnabled('realAlarms')).toBe(false)
  })

  it('each call to the factory returns an independent instance', () => {
    const flagsA = createStaticFeatureFlags({ realAlarms: true })
    const flagsB = createStaticFeatureFlags()
    expect(flagsA.isEnabled('realAlarms')).toBe(true)
    expect(flagsB.isEnabled('realAlarms')).toBe(false)
  })
})
