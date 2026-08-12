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
  | { type: "schedule"; dayOfWeek: ScheduleDayOfWeek };

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
      return "id" in data && typeof (data as { id: unknown }).id === "string";
    case "schedule":
      return "dayOfWeek" in data && isScheduleDayOfWeek((data as { dayOfWeek: unknown }).dayOfWeek);
    default:
      return false;
  }
}

function isScheduleDayOfWeek(value: unknown): value is ScheduleDayOfWeek {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}
