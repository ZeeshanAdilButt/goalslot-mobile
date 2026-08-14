// The pure half of "what is this session tracked against?" — extracted out of
// app/(app)/timer.tsx so it can be unit-tested without rendering a screen.
//
//   1. `cleanLabel` — normalizes a name to a non-blank string or null.
//   2. `isDormantServerSession` / `isDormantLocalSession` — detect a session
//      with nothing attached to it.
//   3. `resolveScheduledTarget` — resolves the schedule block live right now
//      into its Goal/Task.

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
 * ANY sign of content disqualifies it, and an elapsed time that can't be read
 * as a number counts as unknown rather than zero — a session whose duration
 * we can't establish is never called empty.
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
 * time, nothing attached. Deliberately excludes "running" — a running session
 * stays visible in the UI (Resume/Stop still work) rather than being treated
 * as dormant.
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
