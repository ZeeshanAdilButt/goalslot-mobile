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
  journal: (): string => "/journal",
  journalVoiceCapture: (): string => "/journal?voice=1",
  // The one route here that is fed by a REMOTE push rather than a local
  // notification this app scheduled — see `conversation` in
  // DeepLinkNotificationData below.
  conversation: (conversationId: string): string => `/message/${encodeURIComponent(conversationId)}`,
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

/** Shareable deep link to the Journal tab, today's entry, as-is (no voice capture). */
export function journalDeepLink(): string {
  return toDeepLinkUrl(ROUTES.journal());
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
 *   { type: "schedule", dayOfWeek: 0-6 }   // 0 = Sunday .. 6 = Saturday
 *
 * This is the contract the (separately built) `NotificationCapability`
 * implementation needs to target when it schedules a notification — set
 * this shape as its `content.data`. Note `packages/shared/src/capabilities`'s
 * `NotificationInput` doesn't carry a `data` field yet as of this writing;
 * extending it is a prerequisite for real notifications to round-trip
 * through this routing layer. This file doesn't depend on that work landing
 * — it only depends on `expo-notifications`' response shape, which is the
 * same regardless of which `NotificationCapability` implementation
 * schedules the notification (noop or real).
 */
export type DeepLinkNotificationData =
  | { type: "today" }
  | { type: "goal"; id: string }
  | { type: "task"; id: string }
  | { type: "schedule"; dayOfWeek: ScheduleDayOfWeek }
  // The journal reminder's tap target (src/lib/journal-reminders.ts) — opens
  // today's entry directly rather than cold-opening to Today, since the
  // whole point of the notification is "go write in your journal now".
  | { type: "journal" }
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
  | { type: "conversation"; conversationId: string };

/**
 * Resolves a notification's `content.data` payload to the in-app route it
 * should open, or `null` if the payload doesn't match the shape above (e.g.
 * missing, malformed, or an unrelated notification). Returns an
 * expo-router `Href`-compatible string suitable for `router.push(...)`
 * directly — deliberately an in-app path, not a `goalslot://` URL, since
 * `router.push` navigates in-app routes rather than resolving external
 * scheme URLs.
 */
export function resolveNotificationRoute(data: unknown): string | null {
  if (!isDeepLinkNotificationData(data)) {
    return null;
  }
  switch (data.type) {
    case "today":
      return ROUTES.today();
    case "goal":
      return ROUTES.goals(data.id);
    case "task":
      return ROUTES.tasks(data.id);
    case "schedule":
      return ROUTES.scheduleDay(data.dayOfWeek);
    case "journal":
      return ROUTES.journal();
    case "conversation":
      return ROUTES.conversation(data.conversationId);
  }
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
      return (
        "id" in data &&
        typeof (data as { id: unknown }).id === "string" &&
        (data as { id: string }).id.length > 0
      );
    case "schedule":
      return "dayOfWeek" in data && isScheduleDayOfWeek((data as { dayOfWeek: unknown }).dayOfWeek);
    case "journal":
      return true;
    case "conversation":
      return (
        "conversationId" in data &&
        typeof (data as { conversationId: unknown }).conversationId === "string" &&
        (data as { conversationId: string }).conversationId.length > 0
      );
    default:
      return false;
  }
}

function isScheduleDayOfWeek(value: unknown): value is ScheduleDayOfWeek {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}
