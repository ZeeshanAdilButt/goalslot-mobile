// Deep-link helpers for GoalSlot.
//
// expo-router wires every screen under `app/(app)/*` to a route reachable
// via the `goalslot://` scheme configured in `app.json` (`expo.scheme`) —
// that's the "for free" deep linking Phase 4 asked for (see DECISIONS.md).
// This file is the single place that knows how a domain event (a goal, a
// task, a schedule day, "today") maps onto those routes, so callers
// (sharing UI, notification-tap routing) never hardcode a path string.
//
// Scope decision: goals and tasks are flat lists in v1 (DECISIONS.md, "V1
// screen list") — there is no `/goals/[id]` or `/tasks/[id]` detail route.
// `goalDeepLink`/`taskDeepLink` therefore resolve to the relevant LIST
// screen, not a detail screen that doesn't exist. The id is still accepted
// and threaded through as a query param so that (a) call sites can express
// "deep link to this goal" naturally, and (b) the list screen can opt into
// reading it later (e.g. to scroll-to/highlight the item) without any
// caller of these helpers having to change. Until a screen reads it, the
// query param is simply ignored — this file does not touch screen content.
//
// Schedule is a day-agenda view (see DECISIONS.md #5/#6), so
// `scheduleDayDeepLink` targets it with a `day` query param instead of a
// route segment, for the same "no new route" reason.

/** 0 = Sunday .. 6 = Saturday, matching JS `Date#getDay()`. */
export type ScheduleDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * In-app route paths (expo-router `Href` strings), relative to the app
 * root. Kept internal — external callers go through the named
 * `*DeepLink`/`resolveNotificationRoute` functions below so this is the
 * only place a literal path string is written.
 */
const ROUTES = {
  today: (): string => "/",
  goals: (goalId?: string): string => (goalId ? `/goals?goalId=${encodeURIComponent(goalId)}` : "/goals"),
  tasks: (taskId?: string): string => (taskId ? `/tasks?taskId=${encodeURIComponent(taskId)}` : "/tasks"),
  scheduleDay: (dayOfWeek: ScheduleDayOfWeek): string => `/schedule?day=${dayOfWeek}`,
  timer: (): string => "/timer",
  timerAutoStart: (goalId: string): string => `/timer?autostart=1&goalId=${encodeURIComponent(goalId)}`,
  // Used by the "Hey Siri, start timer in GoalSlot" App Intent
  // (ios/GoalSlot/StartTimerIntent.swift) — no goalId is known at Intent
  // time, so this asks the Timer screen to resolve the currently active
  // schedule block itself (the same `resolveActiveBlock` call its
  // auto-select-on-open effect already makes) and start tracking it.
  timerAutoStartActive: (): string => "/timer?autostart=active",
  // Used by the "Hey Siri, start timer for <name> in GoalSlot" App Intent
  // (ios/GoalSlot/StartTimerForGoalIntent.swift) — carries the raw spoken
  // words through for the Timer screen to fuzzy-match via the same
  // `resolveSpokenTarget` the in-app Voice tab and Time Tracker mic button
  // already use (packages/shared/src/voice/resolve.ts).
  timerAutoStartSpoken: (spokenName: string): string =>
    `/timer?autostart=spoken&spokenName=${encodeURIComponent(spokenName)}`,
  journal: (date?: string): string => (date ? `/journal?date=${encodeURIComponent(date)}` : "/journal"),
  journalVoiceCapture: (): string => "/journal?voice=1",
  // The one route here that is fed by a REMOTE push rather than a local
  // notification this app scheduled — see `conversation` in
  // DeepLinkNotificationData below.
  conversation: (conversationId: string): string => `/message/${encodeURIComponent(conversationId)}`,
  // Server-side `INSTRUCTION_ASSIGNED` push target — the mentee-facing
  // "Instructions" screen (app/(app)/instructions.tsx), reached today from
  // Today's "Assigned to you" card. `instructionId` is threaded through as a
  // query param on the same "accepted now, read later" basis as
  // `goals`/`tasks` above — the screen doesn't scroll-to/highlight it yet.
  instructions: (instructionId?: string): string =>
    instructionId ? `/instructions?instructionId=${encodeURIComponent(instructionId)}` : "/instructions",
  // Server-side `SHARED_REPORT_UNVIEWED` push target. The payload only ever
  // carries `sharedAccessId` (a SharedAccess row id), not the mentee's
  // `ownerId` that mentee/[id].tsx actually routes on — resolving one to the
  // other needs an authenticated list call (`sharingQueries.sharedWithMe()`),
  // which this synchronous resolver can't make. Landing on the Sharing list
  // (where that lookup already happens for the human) is the honest "best
  // resolvable" target, not a guess at a detail route that might 404.
  mentees: (): string => "/mentees",
} as const;

/** Must match `expo.scheme` in app.json. */
const DEEP_LINK_SCHEME = "goalslot";

/**
 * Wraps an in-app path into a fully-qualified, shareable deep link, e.g.
 * `goalslot://goals?goalId=123`.
 *
 * Deliberately hand-rolled rather than `expo-linking`'s `Linking.createURL`:
 * that helper resolves the scheme by reading the native
 * `expo-constants` manifest (`Constants.expoConfig`) at call time, which
 * isn't populated in this project's plain-Jest test environment (it throws
 * "expo-linking needs access to the expo-constants manifest…" there) and
 * isn't guaranteed in every runtime this code could execute in. The scheme
 * is a static, known value — `app.json`'s `expo.scheme` — so building the
 * URL directly keeps link generation deterministic and testable everywhere,
 * at the cost of not handling the Expo-Go-specific `exp://.../--/<path>`
 * form (not a concern for this app's dev-client/production-only setup).
 */
function toDeepLinkUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${DEEP_LINK_SCHEME}://${normalizedPath}`;
}

/** Shareable deep link to the Today tab (the app's landing screen). */
export function todayDeepLink(): string {
  return toDeepLinkUrl(ROUTES.today());
}

/** Shareable deep link to a goal. Resolves to the Goals list — see scope decision above. */
export function goalDeepLink(goalId: string): string {
  return toDeepLinkUrl(ROUTES.goals(goalId));
}

/** Shareable deep link to a task. Resolves to the Tasks list — see scope decision above. */
export function taskDeepLink(taskId: string): string {
  return toDeepLinkUrl(ROUTES.tasks(taskId));
}

/** Shareable deep link to the Schedule tab, scoped to a given day of week. */
export function scheduleDayDeepLink(dayOfWeek: ScheduleDayOfWeek): string {
  return toDeepLinkUrl(ROUTES.scheduleDay(dayOfWeek));
}

/**
 * Parses the `day` query param `scheduleDayDeepLink`/`ROUTES.scheduleDay`
 * write (`/schedule?day=N`) back into a `ScheduleDayOfWeek`, or `null` if
 * missing or out of range. app/(app)/schedule.tsx uses this to seed its
 * initial day from a notification tap or shared link — until this existed,
 * the screen always ignored `day` and opened on today's weekday regardless
 * of which day the tap was actually about.
 */
export function parseScheduleDayParam(value: string | undefined): ScheduleDayOfWeek | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return isScheduleDayOfWeek(parsed) ? parsed : null;
}

/** Shareable deep link to the Timer tab as-is — e.g. for jumping to an already-running session. */
export function timerDeepLink(): string {
  return toDeepLinkUrl(ROUTES.timer());
}

/** Deep link to the Timer tab that immediately starts tracking against the given goal — see app/(app)/timer.tsx's `autostart` param handling. */
export function timerAutoStartDeepLink(goalId: string): string {
  return toDeepLinkUrl(ROUTES.timerAutoStart(goalId));
}

/**
 * Deep link to the Timer tab that starts tracking against whichever
 * schedule block is active right now — the hand-off target for the "Hey
 * Siri, start timer in GoalSlot" App Shortcut (see
 * ios/GoalSlot/StartTimerIntent.swift) and its Android App Actions
 * equivalent (plugins/android-shortcuts.xml's `start_timer` shortcut, wired
 * via plugins/withAppActions.js). Unlike `timerAutoStartDeepLink`, no
 * goalId is known at link-build time: the Timer screen resolves the active
 * block itself (`resolveActiveBlock` from
 * packages/shared/src/scheduling/fire-time.ts) and calls `start()` against
 * it — see app/(app)/timer.tsx's `autostart === "active"` effect.
 */
export function timerAutoStartActiveDeepLink(): string {
  return toDeepLinkUrl(ROUTES.timerAutoStartActive());
}

/**
 * Deep link to the Timer tab that starts tracking against a spoken goal or
 * task name — the hand-off target for the "Hey Siri, start timer for
 * <name> in GoalSlot" App Shortcut (see
 * ios/GoalSlot/StartTimerForGoalIntent.swift) and its Android App Actions
 * equivalent (plugins/android-shortcuts.xml's `actions.intent.OPEN_APP_FEATURE`
 * capability, wired via plugins/withAppActions.js). `spokenName` is the raw
 * words the assistant captured for its free-text parameter, passed through
 * untouched for the Timer screen to fuzzy-match via
 * `resolveSpokenTarget`/`parse.ts` (packages/shared/src/voice/), the same
 * logic the in-app Voice tab and Time Tracker mic button already use (see
 * src/components/voice/tracking-commands.ts) — see app/(app)/timer.tsx's
 * `autostart === "spoken"` effect. Only starts on a confident match; an
 * ambiguous or unresolved name leaves the screen open, idle and
 * unattributed rather than guessing.
 */
export function timerAutoStartSpokenDeepLink(spokenName: string): string {
  return toDeepLinkUrl(ROUTES.timerAutoStartSpoken(spokenName));
}

/** Shareable deep link to the Journal tab. Defaults to today's entry; pass `date` (`YYYY-MM-DD`) for a specific past entry. */
export function journalDeepLink(date?: string): string {
  return toDeepLinkUrl(ROUTES.journal(date));
}

/**
 * Deep link to the Journal tab that opens today's entry and immediately
 * starts live speech-to-text capture — the hand-off target for the "Talk
 * about my day" Siri / App Shortcut voice trigger (see
 * ios/GoalSlot/TalkAboutMyDayIntent.swift). Follows the same
 * `?<flag>=1[&...]` idiom as `timerAutoStartDeepLink` above. app/(app)/journal.tsx
 * reads the `voice` param via `useLocalSearchParams`, matching timer.tsx's
 * `autostart` param pattern.
 */
export function journalVoiceCaptureDeepLink(): string {
  return toDeepLinkUrl(ROUTES.journalVoiceCapture());
}

// ---------------------------------------------------------------------------
// Notification-tap routing
// ---------------------------------------------------------------------------

/**
 * The `data` payload every GoalSlot local/push notification must carry so
 * app/_layout.tsx's notification-response listener (wired via
 * `expo-notifications`' `useLastNotificationResponse`) can route a tap to
 * the right screen:
 *
 *   { type: "today" }
 *   { type: "goal", id: "<goalId>" }
 *   { type: "task", id: "<taskId>" }
 *   { type: "schedule", dayOfWeek: 0-6 }        // 0 = Sunday .. 6 = Saturday — local schedule-block alarm
 *   { type: "schedule", sharedAccessId: "<id>" } // SHARED_REPORT_UNVIEWED push — see note below
 *   { type: "journal" }                          // or { type: "journal", date: "YYYY-MM-DD" }
 *   { type: "conversation", conversationId: "<id>" }
 *   { type: "instruction", instructionId: "<id>" }
 *   { type: "release" }                          // or { type: "release", url: "https://..." }
 *
 * This is the contract the `NotificationCapability` implementation targets
 * when it schedules a local notification, and the shape every server push's
 * `data` field is expected to already carry (`packages/shared/src/capabilities`'s
 * `NotificationInputBase.data?: Record<string, unknown>` has carried this
 * since before this file existed — nothing here is waiting on that to land).
 *
 * `resolveNotificationRoute`/`resolveNotificationAction` below are the SINGLE
 * place that maps this data to app behavior — app/_layout.tsx's OS-level
 * tap handler and any future in-app notification-center list are both
 * expected to call through here rather than re-switching on `data.type`
 * themselves, so a new notification type only ever needs teaching once.
 */
export type DeepLinkNotificationData =
  | { type: "today" }
  | { type: "goal"; id: string }
  | { type: "task"; id: string }
  // Local schedule-block alarm (src/lib/schedule-reminders.ts).
  | { type: "schedule"; dayOfWeek: ScheduleDayOfWeek }
  // goal-slot-api's SHARED_REPORT_UNVIEWED push (reminder-dispatch.service.ts's
  // `sweepStaleReports`) reuses the literal tag "schedule" — a real naming
  // collision with the local-alarm member above, not a client-side choice —
  // but carries `sharedAccessId` (a SharedAccess row id) instead of
  // `dayOfWeek`, so the two are disambiguated structurally at the type-guard/
  // resolver, not by the tag alone. Resolving `sharedAccessId` to the
  // specific mentee's report screen (mentee/[id].tsx) would need an
  // authenticated `sharingQueries.sharedWithMe()` lookup this synchronous
  // resolver can't perform, so this routes to the Sharing list instead,
  // where that lookup already happens for the human — see ROUTES.mentees.
  | { type: "schedule"; sharedAccessId: string }
  // The journal reminder's tap target (src/lib/journal-reminders.ts) — opens
  // an entry directly rather than cold-opening to Today, since the whole
  // point of the notification is "go write in your journal now". `date`
  // (`YYYY-MM-DD`) is optional — every local reminder sent today omits it
  // (always means "today's entry"), but a future server-originated journal
  // notification about a specific past entry can carry one.
  | { type: "journal"; date?: string }
  // "<name> sent you a message". Unlike every other member of this union,
  // this payload is minted SERVER-side, not by this app: it is exactly what
  // goal-slot-api's messaging.service.ts puts on the dispatch —
  // `{ type: 'conversation', conversationId }` — and is carried through
  // reminder-dispatch to the Expo channel's message `data` unchanged. The
  // key is `conversationId`, not `id`, because that is what the server
  // sends; renaming it here would just silently stop matching.
  //
  // Routed even in a build where messaging is switched off
  // (messaging-config.ts's `messagingEnabled`): `app/(app)/_layout.tsx`
  // keeps `message/[id]` registered unconditionally and the screen degrades
  // to a "not available" state, so opening it is safe, whereas swallowing
  // the tap would leave a notification that visibly does nothing.
  | { type: "conversation"; conversationId: string }
  // goal-slot-api's INSTRUCTION_ASSIGNED push (both the immediate notify on
  // `InstructionsService.assign` and the daily stale-instruction sweep) —
  // `{ type: 'instruction', instructionId }` verbatim, same server-minted
  // contract as `conversation` above.
  | { type: "instruction"; instructionId: string }
  // Forward-looking: no NotificationType on goal-slot-api dispatches this
  // yet (adding one is a backend change out of this repo's scope), but the
  // shape is settled so the moment a server-side APP_RELEASE/similar type
  // ships, tap-routing already understands it. `url` present → open the
  // release page externally; absent → treat the tap as "check for the
  // OTA update now" (see `checkForUpdateAndReload` in src/lib/updates.ts).
  | { type: "release"; url?: string };

/**
 * What a notification tap should DO — a superset of "navigate to an in-app
 * route", covering the two cases (`release`'s external link / OTA check)
 * that aren't a `router.push`-able path at all. `resolveNotificationRoute`
 * below is a thin navigation-only view over this for callers (e.g. a future
 * notification-center list) that only ever want an `Href` and have no
 * business opening a URL or triggering an app reload.
 */
export type NotificationTapAction =
  | { kind: "navigate"; href: string }
  | { kind: "open-url"; url: string }
  | { kind: "check-for-update" };

/**
 * Resolves a notification's `content.data` payload to what tapping it
 * should do, or `null` if the payload doesn't match a known shape (e.g.
 * missing, malformed, or an unrelated notification). This is the one
 * function that actually switches on `data.type` — see the header comment
 * above.
 */
export function resolveNotificationAction(data: unknown): NotificationTapAction | null {
  if (!isDeepLinkNotificationData(data)) {
    return null;
  }
  switch (data.type) {
    case "today":
      return { kind: "navigate", href: ROUTES.today() };
    case "goal":
      return { kind: "navigate", href: ROUTES.goals(data.id) };
    case "task":
      return { kind: "navigate", href: ROUTES.tasks(data.id) };
    case "schedule":
      return {
        kind: "navigate",
        href: "dayOfWeek" in data ? ROUTES.scheduleDay(data.dayOfWeek) : ROUTES.mentees(),
      };
    case "journal":
      return { kind: "navigate", href: ROUTES.journal(data.date) };
    case "conversation":
      return { kind: "navigate", href: ROUTES.conversation(data.conversationId) };
    case "instruction":
      return { kind: "navigate", href: ROUTES.instructions(data.instructionId) };
    case "release":
      // Only http(s) is ever handed to Linking.openURL — a malformed or
      // unexpected scheme degrades to the safe, always-useful fallback
      // (checking for an OTA update) rather than being opened blind.
      return data.url && isHttpsUrl(data.url)
        ? { kind: "open-url", url: data.url }
        : { kind: "check-for-update" };
  }
}

/**
 * Navigation-only view over `resolveNotificationAction` — returns an
 * expo-router `Href`-compatible string suitable for `router.push(...)`
 * directly when the tap resolves to an in-app route, `null` otherwise
 * (including for `release` taps, which are never a `router.push`-able
 * path — see `NotificationTapAction`/`resolveNotificationAction` for the
 * full behavior a tap handler needs to implement all types).
 */
export function resolveNotificationRoute(data: unknown): string | null {
  const action = resolveNotificationAction(data);
  return action?.kind === "navigate" ? action.href : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\//i.test(value);
}

function isDeepLinkNotificationData(data: unknown): data is DeepLinkNotificationData {
  if (typeof data !== "object" || data === null || !("type" in data)) {
    return false;
  }
  const type = (data as { type: unknown }).type;
  switch (type) {
    case "today":
      return true;
    case "goal":
    case "task":
      return "id" in data && isNonEmptyString((data as { id: unknown }).id);
    case "schedule":
      return (
        ("dayOfWeek" in data && isScheduleDayOfWeek((data as { dayOfWeek: unknown }).dayOfWeek)) ||
        ("sharedAccessId" in data && isNonEmptyString((data as { sharedAccessId: unknown }).sharedAccessId))
      );
    case "journal": {
      if (!("date" in data)) return true;
      const date = (data as { date: unknown }).date;
      return date === undefined || isNonEmptyString(date);
    }
    case "conversation":
      return "conversationId" in data && isNonEmptyString((data as { conversationId: unknown }).conversationId);
    case "instruction":
      return "instructionId" in data && isNonEmptyString((data as { instructionId: unknown }).instructionId);
    case "release": {
      if (!("url" in data)) return true;
      const url = (data as { url: unknown }).url;
      return url === undefined || isNonEmptyString(url);
    }
    default:
      return false;
  }
}

function isScheduleDayOfWeek(value: unknown): value is ScheduleDayOfWeek {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}
