// New: no web equivalent. This is the plug-in seam for voice, alarms, and
// notifications — native implementations land later (Phase 3+ per
// dw-time-mobile/DECISIONS.md), but the interface ships now so screens and
// business logic never reach for a platform API directly. Everything here
// is expressed in terms of this package's own types; `ScheduledAlarm.fireAtUtc`
// is meant to be computed via `../scheduling`'s timezone-safe fire-time
// resolver (resolveActiveBlock / findNextScheduleBlock / buildZonedDateFromParts),
// never derived ad hoc by a caller.

export interface ScheduledAlarm {
  id: string
  scheduleBlockId: string
  /** ISO 8601 UTC instant — computed by src/scheduling's fire-time resolver. */
  fireAtUtc: string
  title: string
}

export interface AlarmCapability {
  scheduleAlarm(alarm: ScheduledAlarm): Promise<void>
  cancelAlarm(alarmId: string): Promise<void>
  listScheduled(): Promise<ScheduledAlarm[]>
}

export interface VoiceCapability {
  isAvailable(): Promise<boolean>
  startListening(onTranscript: (text: string, isFinal: boolean) => void): Promise<void>
  stopListening(): Promise<void>
}

export interface NotificationInput {
  id: string
  title: string
  body: string
  fireAtUtc: string
  /**
   * Arbitrary payload carried on the notification and handed back when the
   * user taps it, so the app can route somewhere specific instead of just
   * opening cold. Deliberately untyped here: this package can't know an
   * individual app's route shape, and typing it would invert the dependency
   * (shared → app). The mobile app narrows it at the tap site — see
   * apps/mobile/src/lib/deep-links.ts's DeepLinkNotificationData.
   */
  data?: Record<string, unknown>
}

export interface NotificationCapability {
  requestPermission(): Promise<boolean>
  scheduleNotification(input: NotificationInput): Promise<void>
  cancelNotification(id: string): Promise<void>
}

export interface Capabilities {
  alarms: AlarmCapability
  voice: VoiceCapability
  notifications: NotificationCapability
}

function createNoopAlarmCapability(): AlarmCapability {
  const scheduled = new Map<string, ScheduledAlarm>()
  return {
    async scheduleAlarm(alarm) {
      scheduled.set(alarm.id, alarm)
    },
    async cancelAlarm(alarmId) {
      scheduled.delete(alarmId)
    },
    async listScheduled() {
      return Array.from(scheduled.values())
    },
  }
}

function createNoopVoiceCapability(): VoiceCapability {
  return {
    async isAvailable() {
      return false
    },
    async startListening() {
      // no-op: nothing is listening, so onTranscript is never invoked.
    },
    async stopListening() {
      // no-op
    },
  }
}

function createNoopNotificationCapability(): NotificationCapability {
  return {
    async requestPermission() {
      return false
    },
    async scheduleNotification() {
      // no-op
    },
    async cancelNotification() {
      // no-op
    },
  }
}

/**
 * A fully inert implementation of `Capabilities`. Lets the rest of the app
 * (and this package's own tests) wire the capability seam end-to-end before
 * any native module exists behind it — every call resolves successfully and
 * does nothing observable.
 */
export function createNoopCapabilities(): Capabilities {
  return {
    alarms: createNoopAlarmCapability(),
    voice: createNoopVoiceCapability(),
    notifications: createNoopNotificationCapability(),
  }
}
