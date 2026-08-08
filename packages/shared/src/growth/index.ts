// New: no web equivalent. This is the growth instrumentation seam —
// analytics + feature flags — kept deliberately cheap right now so it's
// nearly free to swap in a real vendor (Amplitude/PostHog/Segment for
// analytics, a remote-config service for flags) later without touching a
// single call site. Same injected-ports pattern as `../capabilities`:
// interfaces + a typed event/flag surface live here, screens and business
// logic reach through the interface, and the only implementations shipped
// today are inert/console stubs.

/**
 * The v1 event surface. Deliberately scoped to what the upcoming screens
 * (Today, Schedule, Goals, Tasks, Time Tracker, and Journal — reinstated in
 * simplified form after being cut from the original v1 list, see
 * DECISIONS.md #5) actually fire — not a speculative full taxonomy. Each
 * key's payload is the argument shape `track()` requires for that event.
 */
export interface AnalyticsEventMap {
  goalCreated: { goalId: string }
  goalCompleted: { goalId: string }
  goalDeleted: { goalId: string }
  taskCreated: { taskId: string }
  taskCompleted: { taskId: string }
  taskDeleted: { taskId: string }
  scheduleBlockCreated: { scheduleBlockId: string }
  scheduleBlockUpdated: { scheduleBlockId: string }
  scheduleBlockDeleted: { scheduleBlockId: string }
  timerStarted: { taskId?: string; scheduleBlockId?: string }
  timerStopped: { taskId?: string; scheduleBlockId?: string; durationSeconds: number }
  timerPaused: { taskId?: string; scheduleBlockId?: string }
  quickAddOpened: { kind: 'goal' | 'task' | 'slot' }
  noteCreated: { noteId: string; parentId: string | null }
  noteDeleted: { noteId: string }
  noteMoved: { noteId: string }
  screenViewed: { screenName: string }
  journalEntrySaved: { date: string }
}

export type AnalyticsEventName = keyof AnalyticsEventMap

/**
 * A typed union over the event map above — `track()` takes one of these, so
 * the payload shape for `name` is checked at the call site instead of being
 * validated ad hoc.
 */
export type AnalyticsEvent = {
  [Name in AnalyticsEventName]: { name: Name; payload: AnalyticsEventMap[Name] }
}[AnalyticsEventName]

export interface AnalyticsCapability {
  track(event: AnalyticsEvent): void
  identify(userId: string): void
  reset(): void
}

/**
 * Logs every call to `console`. This is the "implementation can be a
 * console stub" version referenced in the project brief — it exists so the
 * analytics seam can be wired through every screen now, with a real vendor
 * SDK dropped in behind this same interface later.
 */
export function createConsoleAnalytics(): AnalyticsCapability {
  return {
    track(event) {
      console.log(`[analytics] ${event.name}`, event.payload)
    },
    identify(userId) {
      console.log(`[analytics] identify`, userId)
    },
    reset() {
      console.log('[analytics] reset')
    },
  }
}

/**
 * v1 flag keys. `voiceAssistant` and `realAlarms` are the two big deferred
 * features (see `../capabilities`'s noop Voice/Alarm implementations and
 * dw-time-mobile/DECISIONS.md) — gating them behind a flag lets their entry
 * points exist in code, unreachable, without waiting on the real feature.
 */
export type FeatureFlagKey = 'voiceAssistant' | 'realAlarms'

export interface FeatureFlagCapability {
  isEnabled(flag: FeatureFlagKey): boolean
}

const ALL_FLAGS_DEFAULT_OFF: Record<FeatureFlagKey, boolean> = {
  voiceAssistant: false,
  realAlarms: false,
}

/**
 * A static, default-off resolver: every flag is off unless explicitly
 * overridden. Safe default for unreleased features — nothing becomes
 * reachable by accident. Simple enough (one object, one lookup) to swap for
 * a real remote-config-backed implementation later without changing any
 * call site, since callers only ever see `FeatureFlagCapability`.
 */
export function createStaticFeatureFlags(
  overrides?: Partial<Record<FeatureFlagKey, boolean>>,
): FeatureFlagCapability {
  const flags: Record<FeatureFlagKey, boolean> = { ...ALL_FLAGS_DEFAULT_OFF, ...overrides }

  return {
    isEnabled(flag) {
      return flags[flag]
    },
  }
}
