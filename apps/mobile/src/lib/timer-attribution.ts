// The pure half of "what is this session tracked against?" — extracted out of
// app/(app)/timer.tsx so the three rules below can be unit-tested without
// rendering a screen (same split tracking-search.ts made for the picker's
// matching rules).
//
// All three exist because of the same confirmed-live failure: the Timer screen
// showed a "Paused" 00:00:00 session whose attribution row was completely
// blank, with no way to select a goal or a task from what was on screen.
//
//   1. `cleanLabel` — every name that reaches this screen crosses the network
//      with no runtime validation (`ActiveTimerSession.taskName` is typed
//      `string | null` but arrives as `""` from at least one writer, and as
//      `undefined` when the field is absent entirely). Anything that isn't a
//      non-blank string is *absent*, not a name. Without this, an empty string
//      is not `null`, so it takes the "we have a title" branch everywhere and
//      renders as an empty row.
//   2. `isDormantServerSession` — a cross-device session that is paused, has
//      measured no time and carries no attribution of any kind represents
//      nothing at all. It is indistinguishable to the user from "nothing is
//      happening", but every guard on the screen used to treat it as a live
//      session: it suppressed the schedule-linked default, put the screen in a
//      permanent "Paused" state, and routed attribution edits through
//      PATCH /timer/session (which, for exactly this shape of session, is the
//      request that hung — see packages/shared/src/api/client.ts's timeout
//      note). Naming the shape is what lets the screen ignore it.
//   3. `resolveScheduledTarget` — the "default to the goal for the schedule
//      block that's live right now" rule, in one place instead of three
//      hand-rolled copies inside effects (auto-select-on-open, the
//      `autostart=active` deep link, and now the one-tap suggestion shown in
//      an empty attribution row).

import {
  resolveActiveBlock,
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

/** First argument that is an actual finite number, or null if none is. */
function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * True for a server session that carries nothing: paused, no measured time,
 * no goal, task, schedule block, name or notes.
 *
 * Stopping such a session would write a TimeEntry for zero minutes under a
 * placeholder name; discarding it loses nothing that exists. Treating it as
 * live, which is what the screen used to do, is what left the user staring at
 * a paused 00:00:00 timer they could neither attribute nor escape.
 *
 * Every check is deliberately conservative — ANY sign of content (a name, a
 * note, an id, a measurable elapsed time) disqualifies it, and an elapsed time
 * that can't be read as a number at all (the confirmed `accumulatedMs: null`
 * case that once rendered "NaN:NaN:NaN") counts as unknown rather than zero,
 * so a session whose duration we can't establish is never called empty.
 */
export function isDormantServerSession(session: ActiveTimerSession | null | undefined): boolean {
  if (!session) return false;
  if (session.status !== "PAUSED") return false;
  if (session.goalId || session.taskId || session.scheduleBlockId) return false;
  if (cleanLabel(session.taskName) !== null) return false;
  if (cleanLabel(session.notes) !== null) return false;
  const elapsedMs = firstFinite(session.accumulatedMs, session.elapsedMs);
  return elapsedMs !== null && elapsedMs < DORMANT_ELAPSED_TOLERANCE_MS;
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
 * time, nothing attached.
 *
 * The same dead end reachable through the other source of truth — a session
 * started and paused inside a second with nothing attached, then left there,
 * looks exactly like "nothing is happening" and yet blocks the
 * schedule-linked default from ever being offered. Deliberately excludes
 * "running": a running session is a decision the user is currently living
 * with, however little time it has measured, and its attribution is theirs to
 * set rather than something to default out from under them.
 */
export function isDormantLocalSession(state: LocalTimerSnapshot): boolean {
  if (state.status !== "paused") return false;
  if (state.taskId || state.goalId) return false;
  const elapsedMs = firstFinite(state.pausedElapsedMs);
  return elapsedMs !== null && elapsedMs < DORMANT_ELAPSED_TOLERANCE_MS;
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
