// The pure half of "what is this session tracked against?" — extracted out of
// app/(app)/timer.tsx so it can be unit-tested without rendering a screen.
//
//   1. `cleanLabel` — normalizes a name to a non-blank string or null.
//   2. `isDormantServerSession` / `isDormantLocalSession` — detect a session
//      with nothing attached to it.
//   3. `resolveScheduledTarget` — resolves the schedule block live right now
//      into its Goal/Task.
//   4. `resolveEffectiveTimer` — collapses "the server session (if any) wins,
//      otherwise the local store" into one snapshot, so every surface that
//      renders a timer agrees on what is running.
//   5. `activeSessionElapsedMs` / `describeStartConflict` — what to tell the
//      user about a session that is already running somewhere else when they
//      press Start (the 409 path).

import {
  formatDuration,
  resolveActiveBlock,
  toActiveTimerSession,
  type ActiveTimerSession,
  type Goal,
  type ScheduleBlock,
  type Task,
  type WeekSchedule,
} from "@goalslot/shared";

/**
 * A name, or `null` when there isn't one. Whitespace-only counts as absent —
 * a row of spaces renders exactly as blank as an empty string does.
 */
export function cleanLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * How much measured time a session may hold and still count as having
 * measured none. The clock renders whole seconds, so anything under one is
 * literally "00:00:00" on screen — and the API refuses to save a sub-minute
 * entry anyway. Deliberately not a looser threshold: this is the tolerance on
 * a check that decides a session can be ignored, so it has to be tight enough
 * that no duration a user could ever recognise falls inside it.
 */
export const DORMANT_ELAPSED_TOLERANCE_MS = 1000;

/**
 * Looser tolerance for exactly one caller: the ongoing shade notification's
 * body always rounds elapsed time to whole minutes (see
 * useTimerNotification's describeSession), so anything under a minute reads
 * as "0m tracked so far" regardless of DORMANT_ELAPSED_TOLERANCE_MS's much
 * tighter 1-second cutoff. A session in that gap — a few real seconds
 * logged, nothing attached — is not dormant by the strict definition
 * (data-loss-sensitive callers, like the schedule auto-start guard, correctly
 * keep treating it as live so it's never silently overwritten) but reads as
 * an identical stuck "Paused · Untitled session" entry to a user who can only
 * ever see whole minutes. Notification suppression alone uses this instead.
 */
export const NOTIFICATION_DORMANT_TOLERANCE_MS = 60_000;

/** First argument that is an actual finite number, or null if none is. */
export function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * True for a server session that carries nothing: paused, no measured time,
 * no goal, task, schedule block, name or notes.
 *
 * ANY sign of content disqualifies it, and an elapsed time that can't be read
 * as a number counts as unknown rather than zero — a session whose duration
 * we can't establish is never called empty. `toleranceMs` defaults to the
 * strict cutoff; pass NOTIFICATION_DORMANT_TOLERANCE_MS for the shade entry.
 */
export function isDormantServerSession(
  session: ActiveTimerSession | null | undefined,
  toleranceMs: number = DORMANT_ELAPSED_TOLERANCE_MS,
): boolean {
  if (!session) return false;
  if (session.status !== "PAUSED") return false;
  if (session.goalId || session.taskId || session.scheduleBlockId) return false;
  if (cleanLabel(session.taskName) !== null) return false;
  if (cleanLabel(session.notes) !== null) return false;
  const elapsedMs = firstFinite(session.accumulatedMs, session.elapsedMs);
  return elapsedMs !== null && elapsedMs < toleranceMs;
}

/** The local timer store's shape, narrowed to what dormancy depends on. */
export interface LocalTimerSnapshot {
  status: "idle" | "running" | "paused";
  pausedElapsedMs: number;
  taskId: string | null;
  goalId: string | null;
}

/**
 * The local-store equivalent of `isDormantServerSession`: paused, no measured
 * time, nothing attached. Deliberately excludes "running" — a running session
 * stays visible in the UI (Resume/Stop still work) rather than being treated
 * as dormant. `toleranceMs` defaults to the strict cutoff; pass
 * NOTIFICATION_DORMANT_TOLERANCE_MS for the shade entry.
 */
export function isDormantLocalSession(
  state: LocalTimerSnapshot,
  toleranceMs: number = DORMANT_ELAPSED_TOLERANCE_MS,
): boolean {
  if (state.status !== "paused") return false;
  if (state.taskId || state.goalId) return false;
  const elapsedMs = firstFinite(state.pausedElapsedMs);
  return elapsedMs !== null && elapsedMs < toleranceMs;
}

/**
 * One timer, whichever side actually knows about it.
 *
 * A server session (`/timer/session`) is authoritative whenever one exists —
 * it is the only thing that can see a timer started on the web app, the
 * Coach, or another phone. The local zustand store is the fallback, and is
 * also what carries a session started while offline.
 *
 * Shared by the Timer screen and the app-wide tracking banner so the two can
 * never disagree about what is running: before this existed only the screen
 * did the merge, and the banner read the local store alone — so a timer
 * started on web was invisible everywhere except the Timer tab.
 */
export function resolveEffectiveTimer(
  server: ActiveTimerSession | null | undefined,
  local: LocalTimerSnapshot & { startedAt: number | null },
): LocalTimerSnapshot & { startedAt: number | null } {
  if (!server) return local;

  const running = server.status === "RUNNING";
  // `Date.parse` of a malformed/absent timestamp is NaN, which would
  // propagate into `now - startedAt` and render the clock as NaN. Treat an
  // unreadable segment start as "no open segment" instead: the accumulated
  // total still shows, it just stops ticking.
  const segmentStartedAt = running && server.segmentStartedAt ? Date.parse(server.segmentStartedAt) : NaN;

  return {
    status: running ? "running" : "paused",
    startedAt: Number.isFinite(segmentStartedAt) ? segmentStartedAt : null,
    // `accumulatedMs` crosses the network with no runtime validation despite
    // its `number` type — a live case produced a paused session whose ring
    // read "NaN:NaN:NaN".
    pausedElapsedMs: firstFinite(server.accumulatedMs) ?? 0,
    taskId: server.taskId ?? null,
    goalId: server.goalId ?? null,
  };
}

/**
 * Elapsed ms for a session as of `now`, not as of when the server built the
 * response.
 *
 * `elapsedMs` is a snapshot paired with `serverTime` (see the API's
 * `toResponse`), so for a RUNNING session it is already stale by the time it
 * reaches the phone — a session the user is being asked about could have
 * been sitting in the react-query cache for a poll interval. Rolling it
 * forward by (now - serverTime) is what stops the conflict dialog from
 * under-reporting how long the other device has been tracking.
 */
export function activeSessionElapsedMs(session: ActiveTimerSession, now: Date): number {
  const base = firstFinite(session.elapsedMs, session.accumulatedMs) ?? 0;
  if (session.status !== "RUNNING") return Math.max(0, base);
  const serverTime = Date.parse(session.serverTime);
  if (!Number.isFinite(serverTime)) return Math.max(0, base);
  return Math.max(0, base + Math.max(0, now.getTime() - serverTime));
}

/**
 * Which device the conflicting session came from, in words. `lastClient` is
 * set purely so a takeover prompt can name the other device (see the API's
 * StartTimerSessionDto) and is free-text as far as this client is concerned,
 * so anything unrecognised degrades to the honest vague answer rather than
 * being echoed back at the user.
 */
function describeClient(lastClient: string | null | undefined): string {
  switch (lastClient) {
    case "web":
      return "the web app";
    case "ios":
      return "an iPhone or iPad";
    case "android":
      return "an Android device";
    default:
      return "another device";
  }
}

/**
 * A `POST /timer/session` rejection, read as "a session is already running"
 * or not.
 *
 * Returns null for anything that is not a 409 — offline, a timeout, a
 * plan-limit 403 — because those must not be presented to the user as a
 * conflict. `session` is null for a 409 whose body carries no session (the
 * row can vanish between the failed insert and the API's re-read of it), and
 * the body is validated through the same `toActiveTimerSession` guard the
 * GET path uses rather than trusted, since this is unvalidated network JSON.
 */
export interface StartConflict {
  session: ActiveTimerSession | null;
}

export function readStartConflict(err: unknown): StartConflict | null {
  const response = (err as { response?: { status?: number; data?: unknown } } | undefined)?.response;
  if (!response || response.status !== 409) return null;
  const body = response.data as { activeSession?: unknown } | undefined;
  return { session: toActiveTimerSession(body?.activeSession) };
}

/**
 * The body copy for the "already running somewhere else" dialog.
 *
 * States the two facts the user needs to choose between resuming it here and
 * replacing it — what it is tracking and how long it has been going — and is
 * explicit that replacing it SAVES that time rather than throwing it away,
 * because that is what this app's "Stop & Start Fresh" actually does (it
 * calls the API's own stop, which writes a TimeEntry, before starting the
 * new session — NOT the bare `takeOver: true`, which the API documents as
 * discarding the replaced session with no entry written).
 */
export function describeStartConflict(session: ActiveTimerSession, now: Date): string {
  const label =
    cleanLabel(session.task?.title) ?? cleanLabel(session.goal?.title) ?? cleanLabel(session.taskName);
  const subject = label === null ? "A timer" : `"${label}"`;
  const duration = formatDuration(Math.floor(activeSessionElapsedMs(session, now) / 60_000));
  const verb = session.status === "RUNNING" ? "has been running" : "is paused";
  return (
    `${subject} ${verb} on ${describeClient(session.lastClient)}, with ${duration} tracked so far. ` +
    `Resume it here to keep going, or stop it — that saves the ${duration} as an entry — and start a new session.`
  );
}

/** Everything the auto-select-on-open effect's up-front guard needs, besides the live-store recheck it performs separately — see `isLiveStoreIdleForAutoSelect`. */
export interface AutoSelectGuardInput {
  effectiveStatus: "idle" | "running" | "paused";
  localDormant: boolean;
  userSelected: boolean;
  hasSelectedTask: boolean;
  hasSelectedGoal: boolean;
}

/**
 * The auto-select-on-open effect's (app/(app)/timer.tsx) render-time gate:
 * whether it's even worth resolving the live schedule block. Cheap to
 * compute before bothering to call `resolveScheduledTarget`, and pulled out
 * here so this exact decision has a permanent regression test instead of
 * living only inline in a 1000+ line screen component.
 *
 * Deliberately does NOT take the screen's `autostart` deep-link param,
 * unlike an earlier version of this guard. That version gated on
 * `autostart === undefined`, reasoning that one of the three deep-link
 * effects (autostart=1/active/spoken) might be about to call `start()`
 * itself, and a stale "idle" read here could clobber it with `retarget()`.
 * That race is real, but the caller's live-store recheck right before
 * mutating (`isLiveStoreIdleForAutoSelect`, called against
 * `useTimerStore.getState()` synchronously, not a value closed over at
 * render time) already catches it: a deep-link effect is declared earlier
 * in the component and so runs earlier in the same effect flush, and its
 * `start()` updates the zustand store synchronously — so by the time this
 * guard's live recheck runs moments later in that same flush, it already
 * observes the non-idle state. Gating on `autostart` here too was therefore
 * both redundant AND the confirmed-by-reading-the-code root cause of this
 * feature going permanently silent: expo-router's Tabs navigator never
 * clears a route's params on refocus (only a fresh navigation with new ones
 * does), so once a user opened this screen even once via the widget's Start
 * button, a Siri Shortcut, or an Android App Action, `autostart` stayed a
 * defined string in the route's params for the rest of that tab's mounted
 * lifetime — effectively the rest of the app process's life, since tabs
 * stay mounted in this app. Every later visit then failed this guard's
 * first condition and silently skipped auto-select, with nothing on screen
 * to suggest why. Confirmed by reading the effect ordering and expo-router's
 * params-persist-on-refocus behavior, not verified on a physical device;
 * removing the redundant check cannot reintroduce the race it existed for.
 */
export function canAttemptAutoSelect(input: AutoSelectGuardInput): boolean {
  if (input.effectiveStatus !== "idle" && !input.localDormant) return false;
  if (input.userSelected) return false;
  if (input.hasSelectedTask || input.hasSelectedGoal) return false;
  return true;
}

/**
 * The auto-select-on-open effect's second gate, re-checked against LIVE
 * store state immediately before mutating rather than the value closed over
 * at render time — see `canAttemptAutoSelect`'s doc for why that
 * distinction is what actually keeps this safe.
 */
export function isLiveStoreIdleForAutoSelect(live: LocalTimerSnapshot, hasServerSession: boolean): boolean {
  if (hasServerSession) return false;
  return live.status === "idle" || isDormantLocalSession(live);
}

/** The goal (and optionally task) implied by whatever schedule block is live right now. */
export interface ScheduledTarget {
  block: ScheduleBlock;
  goal: Goal;
  /**
   * The block's first task, if it names any AND that task is in the loaded
   * list. A block can name several with no ordering signal to prefer one, so
   * the first is an accepted simplification rather than a guess at intent.
   */
  task: Task | null;
}

/**
 * The schedule block covering `now`, resolved into real Goal/Task objects.
 *
 * Returns null unless every list it needs has loaded — an
 * undefined-vs-empty distinction matters (a still-loading query is
 * `undefined`, a genuinely empty one is `[]`), which is why callers can't
 * substitute `[]` and check `.length` themselves.
 */
export function resolveScheduledTarget(
  schedule: WeekSchedule | undefined,
  goals: Goal[] | undefined,
  tasks: Task[] | undefined,
  now: Date,
  timezone: string,
): ScheduledTarget | null {
  if (!schedule || !goals || !tasks) return null;

  const block = resolveActiveBlock(schedule, now, timezone);
  if (!block) return null;

  const goalId = block.goalId ?? block.goal?.id;
  if (!goalId) return null;
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return null;

  const blockTaskId = block.tasks?.[0]?.id;
  const task = blockTaskId ? (tasks.find((t) => t.id === blockTaskId) ?? null) : null;

  return { block, goal, task };
}
