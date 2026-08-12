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

/**
 * Whether the OS will let this app listen. 'undetermined' is the only state
 * in which asking is allowed — asking again after a denial does nothing on
 * either platform except train the user to ignore the app, so a caller that
 * sees 'denied' must send them to Settings instead of re-prompting.
 */
export type VoicePermissionStatus = 'granted' | 'denied' | 'undetermined'

/**
 * Every way listening can end badly, reduced to the cases a UI actually
 * renders differently. The platform error vocabularies are larger than this
 * and not worth exposing: an app cannot do anything different about
 * "bad-grammar" than about "client".
 */
export type VoiceErrorKind =
  /** The OS refused, or permission was never granted. Route to Settings. */
  | 'permission-denied'
  /** Heard nothing. Not a failure — offer another go. */
  | 'no-speech'
  /** No recognizer on this device, or the locale isn't installed. */
  | 'unavailable'
  /** Recognition needed the network and didn't have it. */
  | 'network'
  /** The microphone itself could not be read (in use, hardware, interrupted). */
  | 'audio'
  | 'unknown'

export interface VoiceError {
  readonly kind: VoiceErrorKind
  /** Sentence shown to the user. Always written for a person, never a code. */
  readonly message: string
}

export interface VoiceListenHandlers {
  /**
   * Called repeatedly while someone talks (`isFinal: false`) and once when
   * the recognizer commits (`isFinal: true`). Interim text is for display
   * only — acting on it means acting on half a sentence.
   */
  onTranscript(text: string, isFinal: boolean): void
  onError?(error: VoiceError): void
  /** The session is over, however it ended. Always the last call. */
  onEnd?(): void
}

/**
 * Speech capture. Deliberately transcript-only: this port hears words and
 * stops there. What a sentence *means* is decided by `../voice`'s parser
 * (tracking commands) or by the Coach (everything else), neither of which
 * should have to know which native module produced the string.
 */
export interface VoiceCapability {
  /** A recognizer exists on this device. Independent of permission. */
  isAvailable(): Promise<boolean>
  getPermission(): Promise<VoicePermissionStatus>
  /** Prompts. Only call when `getPermission()` returned 'undetermined'. */
  requestPermission(): Promise<VoicePermissionStatus>
  startListening(handlers: VoiceListenHandlers): Promise<void>
  /** Stop and take the final transcript. */
  stopListening(): Promise<void>
  /** Stop and throw the transcript away — the user backed out. */
  cancelListening(): Promise<void>
}

interface NotificationInputBase {
  id: string
  title: string
  body: string
  /**
   * Arbitrary payload carried on the notification and handed back when the
   * user taps it, so the app can route somewhere specific instead of just
   * opening cold. Deliberately untyped here: this package can't know an
   * individual app's route shape, and typing it would invert the dependency
   * (shared → app). The mobile app narrows it at the tap site — see
   * apps/mobile/src/lib/deep-links.ts's DeepLinkNotificationData.
   */
  data?: Record<string, unknown>
  /**
   * Ask for this to be delivered as an ALARM rather than a quiet notice:
   * audible, heads-up, and allowed to interrupt a Focus/Do-Not-Disturb
   * profile. Defaults to false — a plain notification.
   *
   * WHY this is one semantic flag rather than the platform fields it maps
   * onto (`sound`, an Android channel id + importance, iOS
   * `interruptionLevel`): this package is the capability port, and naming
   * expo/Android/iOS concepts here would push platform detail up into every
   * caller and defeat the boundary. Callers say WHAT they need — "this must
   * wake someone up" — and the one file allowed to import expo-notifications
   * (apps/mobile/src/lib/notifications.ts) decides HOW.
   *
   * A caller that sets this is not guaranteed an alarm: on Android 12+ exact
   * delivery additionally depends on the app holding SCHEDULE_EXACT_ALARM /
   * USE_EXACT_ALARM (declared in app.json), and on either platform the user
   * can always silence the channel afterwards. It is a request, not a
   * promise — the same contract as `scheduleNotification` itself, which
   * resolves even when permission was refused.
   */
  alarm?: boolean
}

/** Fires once, at an exact absolute instant — e.g. a coach nudge or a one-off deadline. */
interface OneShotNotificationInput extends NotificationInputBase {
  fireAtUtc: string
  repeat?: never
}

/**
 * Fires every week when device-local wall-clock time matches `weekday`/
 * `hour`/`minute` — schedule-block reminders, which recur on the block's own
 * `dayOfWeek` (0 = Sunday, matching ScheduleBlock) every week indefinitely,
 * not just once. There is no absolute `fireAtUtc` for a recurring trigger by
 * definition, so this variant omits it rather than asking a caller to invent
 * one.
 *
 * Local wall-clock time (not a stored IANA zone) is deliberate here, same as
 * how a phone's own alarm clock behaves: a 9pm reminder should keep firing
 * at 9pm after the user's local zone or DST offset changes, not silently
 * follow whatever zone the schedule was originally authored in.
 */
interface RecurringNotificationInput extends NotificationInputBase {
  fireAtUtc?: never
  repeat: {
    /** 0 (Sunday) - 6 (Saturday), matching ScheduleBlock.dayOfWeek. */
    weekday: number
    hour: number
    minute: number
  }
}

export type NotificationInput = OneShotNotificationInput | RecurringNotificationInput

/**
 * What the OS currently thinks about this app and notifications.
 *
 * The three states are not two states with a nicety on top — they need three
 * different pieces of UI. `undetermined` means an in-app "Allow
 * notifications" button will actually raise the system prompt. `denied`
 * means it won't: iOS only ever asks once, so the only route back is the
 * device's own settings app, and a button that silently does nothing is
 * worse than no button. `granted` means neither control should be shown.
 */
export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined'

export interface NotificationCapability {
  /**
   * Reads the current permission without prompting.
   *
   * Exists so a settings screen can show the truth instead of a local mirror
   * of "did the last requestPermission() call succeed" — that mirror resets
   * on every app launch, and it goes stale the moment the user changes the
   * permission in the OS settings app and comes back.
   */
  getPermissionStatus(): Promise<NotificationPermissionStatus>
  requestPermission(): Promise<boolean>
  scheduleNotification(input: NotificationInput): Promise<void>
  cancelNotification(id: string): Promise<void>
  /**
   * Identifiers of everything this app currently has QUEUED (not delivered).
   *
   * WHY the port needs this: a recurring notification outlives the record
   * that created it. Delete a schedule block — here, or on the web, or from
   * another device — and its weekly alarm is still sitting in the OS queue,
   * firing every week for a block that no longer exists. Nothing derived
   * from the app's own data can find it, because the block it was named
   * after is gone; the only way to notice an orphan is to ask the OS what it
   * is actually holding and diff that against what should be there.
   *
   * Resolves to an empty array rather than rejecting when the platform can't
   * answer — callers use this to prune, and a failed prune must degrade to
   * "left the queue alone", never to a thrown error mid-reconcile.
   */
  listScheduledIds(): Promise<string[]>
  /**
   * Drops every notification this app owns on the device — the ones still
   * queued to fire and the ones already delivered and sitting in the shade.
   *
   * WHY the port needs a bulk operation instead of callers looping over
   * `cancelNotification`: the one caller that needs this is sign-out, and by
   * then it cannot enumerate the ids. Notification ids are minted from
   * account-scoped server ids (`schedule-reminder-<blockId>`), so the only
   * record of what is pending is the very data a sign-out has just thrown
   * away. Anything the caller could reconstruct would be a guess, and a
   * missed id is a notification that fires for the next person on the device
   * carrying the previous account's wording.
   *
   * Resolves rather than rejects even when the platform refuses. Sign-out is
   * the caller, and a user must always be able to sign out.
   */
  clearAllNotifications(): Promise<void>
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
    async getPermission() {
      // Not 'denied': nothing was ever asked, and a UI that treats this as a
      // refusal would send the user to Settings to fix a permission that is
      // not the problem. `isAvailable()` above is what the UI should branch
      // on when there is no recognizer at all.
      return 'undetermined'
    },
    async requestPermission() {
      return 'undetermined'
    },
    async startListening() {
      // no-op: nothing is listening, so no handler is ever invoked.
    },
    async stopListening() {
      // no-op
    },
    async cancelListening() {
      // no-op
    },
  }
}

function createNoopNotificationCapability(): NotificationCapability {
  return {
    async getPermissionStatus() {
      // 'denied' rather than 'undetermined': `requestPermission` below always
      // returns false, so reporting "you can still be asked" would invite a
      // caller to render a prompt button that can never succeed.
      return 'denied'
    },
    async requestPermission() {
      return false
    },
    async scheduleNotification() {
      // no-op
    },
    async cancelNotification() {
      // no-op
    },
    async listScheduledIds() {
      // Nothing was ever scheduled, so nothing is queued.
      return []
    },
    async clearAllNotifications() {
      // no-op: nothing was ever scheduled, so there is nothing to clear.
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
