// No import of `describe`/`it`/`expect`: Jest injects these as real globals at
// test-runtime and this project has no @types/jest installed (see
// timer-reminders.test.ts for the same note), so this file is excluded from
// `tsc --noEmit` via tsconfig.json's `exclude`.
import type { ActiveTimerSession, Goal, ScheduleBlock, Task, WeekSchedule } from "@goalslot/shared";

import {
  activeSessionElapsedMs,
  canAttemptAutoSelect,
  DORMANT_ELAPSED_TOLERANCE_MS,
  cleanLabel,
  describeStartConflict,
  firstFinite,
  isDormantLocalSession,
  isDormantServerSession,
  isLiveStoreIdleForAutoSelect,
  readStartConflict,
  resolveEffectiveTimer,
  resolveScheduledTarget,
  type AutoSelectGuardInput,
  type LocalTimerSnapshot,
} from "./timer-attribution";

function goal(overrides: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  return {
    category: "WORK",
    targetHours: 10,
    loggedHours: 0,
    status: "ACTIVE",
    color: "#112233",
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return { status: "TODO", ...overrides };
}

function block(
  overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "startTime" | "endTime" | "dayOfWeek">,
): ScheduleBlock {
  return {
    title: "Block",
    category: "WORK",
    color: "#000000",
    isRecurring: true,
    isPrivate: false,
    seriesId: "series-1",
    ...overrides,
  };
}

/** A paused session carrying nothing at all — the shape the screen has to be able to ignore. */
function dormantSession(overrides: Partial<ActiveTimerSession> = {}): ActiveTimerSession {
  return {
    id: "session-1",
    status: "PAUSED",
    startedAt: "2026-08-14T09:00:00.000Z",
    segmentStartedAt: null,
    pausedAt: "2026-08-14T09:00:00.000Z",
    accumulatedMs: 0,
    elapsedMs: 0,
    serverTime: "2026-08-14T09:00:00.000Z",
    isStale: false,
    cappedElapsedMs: 0,
    maxSessionMs: 43_200_000,
    taskName: null,
    notes: null,
    goalId: null,
    goal: null,
    taskId: null,
    task: null,
    scheduleBlockId: null,
    scheduleBlock: null,
    lastClient: null,
    createdAt: "2026-08-14T09:00:00.000Z",
    updatedAt: "2026-08-14T09:00:00.000Z",
    ...overrides,
  };
}

describe("cleanLabel", () => {
  it("keeps a real name, trimmed", () => {
    expect(cleanLabel("  Deep work ")).toBe("Deep work");
  });

  it("treats every shape of 'no name' as absent", () => {
    expect(cleanLabel(null)).toBeNull();
    expect(cleanLabel(undefined)).toBeNull();
    // The confirmed live case: a server session whose taskName is an empty
    // string used to render as an attribution row with no text in it at all,
    // because "" is not null.
    expect(cleanLabel("")).toBeNull();
    expect(cleanLabel("   ")).toBeNull();
  });

  it("ignores non-strings that arrive despite the type", () => {
    expect(cleanLabel(42 as unknown as string)).toBeNull();
  });
});

describe("firstFinite", () => {
  it("returns the first finite number among its arguments", () => {
    expect(firstFinite(null, undefined, 42)).toBe(42);
    expect(firstFinite(5, 10)).toBe(5);
  });

  it("returns null when nothing finite is present", () => {
    // The confirmed live case this guards elsewhere: a numeric field that
    // arrives as `null` or `undefined` from the server must not silently
    // become `NaN` downstream (e.g. `Math.round(undefined / 1000)`).
    expect(firstFinite(null, undefined, NaN)).toBeNull();
    expect(firstFinite()).toBeNull();
  });
});

describe("isDormantServerSession", () => {
  it("is false when there is no session at all", () => {
    expect(isDormantServerSession(null)).toBe(false);
    expect(isDormantServerSession(undefined)).toBe(false);
  });

  it("is true for a paused, zero-elapsed, unattributed session", () => {
    expect(isDormantServerSession(dormantSession())).toBe(true);
  });

  it("is true when the empty name arrives as a blank string rather than null", () => {
    expect(isDormantServerSession(dormantSession({ taskName: "  " }))).toBe(true);
  });

  it("is false for anything still running", () => {
    expect(isDormantServerSession(dormantSession({ status: "RUNNING" }))).toBe(false);
  });

  it("is false once any attribution is attached", () => {
    expect(isDormantServerSession(dormantSession({ goalId: "goal-1" }))).toBe(false);
    expect(isDormantServerSession(dormantSession({ taskId: "task-1" }))).toBe(false);
    expect(isDormantServerSession(dormantSession({ scheduleBlockId: "block-1" }))).toBe(false);
    expect(isDormantServerSession(dormantSession({ taskName: "gym" }))).toBe(false);
    expect(isDormantServerSession(dormantSession({ notes: "back day" }))).toBe(false);
  });

  it("is false as soon as a whole second has been measured", () => {
    expect(isDormantServerSession(dormantSession({ accumulatedMs: DORMANT_ELAPSED_TOLERANCE_MS }))).toBe(false);
    expect(isDormantServerSession(dormantSession({ accumulatedMs: 60_000 }))).toBe(false);
  });

  it("falls back to elapsedMs when accumulatedMs is missing", () => {
    const missing = dormantSession({ accumulatedMs: null as unknown as number });
    expect(isDormantServerSession(missing)).toBe(true);
    expect(isDormantServerSession({ ...missing, elapsedMs: 90_000 })).toBe(false);
  });

  it("refuses to call a session empty when its elapsed time is unreadable", () => {
    // Neither field is a number: the duration is unknown, not zero, so this
    // session must never be treated as one that holds nothing.
    const unreadable = dormantSession({
      accumulatedMs: null as unknown as number,
      elapsedMs: undefined as unknown as number,
    });
    expect(isDormantServerSession(unreadable)).toBe(false);
  });
});

describe("isDormantLocalSession", () => {
  function local(overrides: Partial<LocalTimerSnapshot> = {}): LocalTimerSnapshot {
    return { status: "paused", pausedElapsedMs: 0, taskId: null, goalId: null, ...overrides };
  }

  it("is true for a paused, zero-elapsed, unattributed store", () => {
    expect(isDormantLocalSession(local())).toBe(true);
  });

  it("is false while idle — there is no session to be dormant", () => {
    expect(isDormantLocalSession(local({ status: "idle" }))).toBe(false);
  });

  it("is false while running, however little has been measured", () => {
    // A running session is a decision the user is currently living with.
    expect(isDormantLocalSession(local({ status: "running" }))).toBe(false);
  });

  it("is false once time has been measured or something is attached", () => {
    expect(isDormantLocalSession(local({ pausedElapsedMs: DORMANT_ELAPSED_TOLERANCE_MS }))).toBe(false);
    expect(isDormantLocalSession(local({ taskId: "task-1" }))).toBe(false);
    expect(isDormantLocalSession(local({ goalId: "goal-1" }))).toBe(false);
  });

  it("is false when the elapsed time isn't a readable number", () => {
    expect(isDormantLocalSession(local({ pausedElapsedMs: NaN }))).toBe(false);
  });
});

describe("canAttemptAutoSelect", () => {
  function guard(overrides: Partial<AutoSelectGuardInput> = {}): AutoSelectGuardInput {
    return {
      effectiveStatus: "idle",
      localDormant: false,
      userSelected: false,
      hasSelectedTask: false,
      hasSelectedGoal: false,
      ...overrides,
    };
  }

  it("is true for a genuinely idle, untouched screen", () => {
    expect(canAttemptAutoSelect(guard())).toBe(true);
  });

  it("is true for a dormant session even though it isn't idle", () => {
    expect(canAttemptAutoSelect(guard({ effectiveStatus: "paused", localDormant: true }))).toBe(true);
  });

  it("is false while genuinely running or paused with content", () => {
    expect(canAttemptAutoSelect(guard({ effectiveStatus: "running" }))).toBe(false);
    expect(canAttemptAutoSelect(guard({ effectiveStatus: "paused" }))).toBe(false);
  });

  it("is false once the user has made a pick this visit", () => {
    expect(canAttemptAutoSelect(guard({ userSelected: true }))).toBe(false);
  });

  it("is false once a task or goal is already selected", () => {
    expect(canAttemptAutoSelect(guard({ hasSelectedTask: true }))).toBe(false);
    expect(canAttemptAutoSelect(guard({ hasSelectedGoal: true }))).toBe(false);
  });

  // Regression test for the actual reported bug: a prior version of this
  // guard also required an `autostart` deep-link param to be unset, but
  // that param — set by the widget's Start button, a Siri Shortcut, or an
  // Android App Action, via `goalslot://timer?autostart=...` — is never
  // cleared by expo-router on tab refocus (only a fresh navigation with new
  // params clears it), so it stayed permanently set for the rest of the
  // app process's life after the FIRST use of any of those entry points.
  // That permanently disabled auto-select-on-open for every later visit to
  // this screen. This function intentionally has no `autostart` parameter
  // at all — there is nothing here that COULD reintroduce that bug.
  it("has no autostart/deep-link parameter to ever get stuck on", () => {
    const input = guard();
    expect(Object.keys(input)).not.toContain("autostart");
  });
});

describe("isLiveStoreIdleForAutoSelect", () => {
  function live(overrides: Partial<LocalTimerSnapshot> = {}): LocalTimerSnapshot {
    return { status: "idle", pausedElapsedMs: 0, taskId: null, goalId: null, ...overrides };
  }

  it("is true for a genuinely idle local store with no server session", () => {
    expect(isLiveStoreIdleForAutoSelect(live(), false)).toBe(true);
  });

  it("is true for a dormant paused local store", () => {
    expect(isLiveStoreIdleForAutoSelect(live({ status: "paused" }), false)).toBe(true);
  });

  it("is false the instant a server session exists, regardless of local state", () => {
    expect(isLiveStoreIdleForAutoSelect(live(), true)).toBe(false);
  });

  it("is false for a local store a sibling deep-link effect just started", () => {
    // The exact race this function exists to catch: a same-tick `start()`
    // call (from one of the autostart deep-link effects, which run earlier
    // in the same effect flush) has already flipped the store to "running"
    // by the time this check runs.
    expect(isLiveStoreIdleForAutoSelect(live({ status: "running" }), false)).toBe(false);
  });

  it("is false for a paused local store holding real content", () => {
    expect(isLiveStoreIdleForAutoSelect(live({ status: "paused", goalId: "goal-1" }), false)).toBe(false);
  });
});

describe("resolveScheduledTarget", () => {
  // Friday Aug 7 2026, 10:30 America/New_York (EDT, UTC-4) => 14:30 UTC.
  const NOW = new Date("2026-08-07T14:30:00Z");
  const ZONE = "America/New_York";

  const goals = [goal({ id: "goal-1", title: "Deen" }), goal({ id: "goal-2", title: "Fitness" })];
  const tasks = [task({ id: "task-1", title: "Qur'an", goalId: "goal-1" })];

  it("returns null until every list has loaded", () => {
    const schedule: WeekSchedule = {
      5: [block({ id: "b1", startTime: "09:00", endTime: "12:00", dayOfWeek: 5, goalId: "goal-1" })],
    };
    expect(resolveScheduledTarget(undefined, goals, tasks, NOW, ZONE)).toBeNull();
    expect(resolveScheduledTarget(schedule, undefined, tasks, NOW, ZONE)).toBeNull();
    expect(resolveScheduledTarget(schedule, goals, undefined, NOW, ZONE)).toBeNull();
  });

  it("resolves the live block's goal", () => {
    const schedule: WeekSchedule = {
      5: [block({ id: "b1", startTime: "09:00", endTime: "12:00", dayOfWeek: 5, goalId: "goal-1" })],
    };
    const resolved = resolveScheduledTarget(schedule, goals, tasks, NOW, ZONE);
    expect(resolved?.goal.id).toBe("goal-1");
    expect(resolved?.block.id).toBe("b1");
    expect(resolved?.task).toBeNull();
  });

  it("reads the goal off the embedded summary when the block has no goalId", () => {
    const schedule: WeekSchedule = {
      5: [
        block({
          id: "b1",
          startTime: "09:00",
          endTime: "12:00",
          dayOfWeek: 5,
          goal: { id: "goal-2", title: "Fitness", color: "#112233" },
        }),
      ],
    };
    expect(resolveScheduledTarget(schedule, goals, tasks, NOW, ZONE)?.goal.id).toBe("goal-2");
  });

  it("resolves the block's first task alongside the goal", () => {
    const schedule: WeekSchedule = {
      5: [
        block({
          id: "b1",
          startTime: "09:00",
          endTime: "12:00",
          dayOfWeek: 5,
          goalId: "goal-1",
          tasks: [{ id: "task-1", title: "Qur'an", status: "TODO" }],
        }),
      ],
    };
    const resolved = resolveScheduledTarget(schedule, goals, tasks, NOW, ZONE);
    expect(resolved?.task?.id).toBe("task-1");
  });

  it("still resolves the goal when the block names a task that isn't loaded", () => {
    const schedule: WeekSchedule = {
      5: [
        block({
          id: "b1",
          startTime: "09:00",
          endTime: "12:00",
          dayOfWeek: 5,
          goalId: "goal-1",
          tasks: [{ id: "task-gone", title: "Deleted", status: "TODO" }],
        }),
      ],
    };
    const resolved = resolveScheduledTarget(schedule, goals, tasks, NOW, ZONE);
    expect(resolved?.goal.id).toBe("goal-1");
    expect(resolved?.task).toBeNull();
  });

  it("returns null when nothing is scheduled, the block has no goal, or the goal is gone", () => {
    expect(resolveScheduledTarget({}, goals, tasks, NOW, ZONE)).toBeNull();
    expect(
      resolveScheduledTarget(
        { 5: [block({ id: "b1", startTime: "09:00", endTime: "12:00", dayOfWeek: 5 })] },
        goals,
        tasks,
        NOW,
        ZONE,
      ),
    ).toBeNull();
    expect(
      resolveScheduledTarget(
        { 5: [block({ id: "b1", startTime: "09:00", endTime: "12:00", dayOfWeek: 5, goalId: "goal-gone" })] },
        goals,
        tasks,
        NOW,
        ZONE,
      ),
    ).toBeNull();
  });
});

describe("resolveEffectiveTimer", () => {
  const idleLocal = { status: "idle" as const, startedAt: null, pausedElapsedMs: 0, taskId: null, goalId: null };
  const runningLocal = {
    status: "running" as const,
    startedAt: 1_700_000_000_000,
    pausedElapsedMs: 5_000,
    taskId: "task-1",
    goalId: "goal-1",
  };

  it("falls back to the local store when there is no server session", () => {
    expect(resolveEffectiveTimer(null, runningLocal)).toEqual(runningLocal);
    expect(resolveEffectiveTimer(undefined, runningLocal)).toEqual(runningLocal);
  });

  it("lets a running server session win over the local store entirely", () => {
    const server = dormantSession({
      status: "RUNNING",
      segmentStartedAt: "2026-08-14T09:00:00.000Z",
      accumulatedMs: 120_000,
      taskId: "server-task",
      goalId: "server-goal",
    });
    expect(resolveEffectiveTimer(server, runningLocal)).toEqual({
      status: "running",
      startedAt: Date.parse("2026-08-14T09:00:00.000Z"),
      pausedElapsedMs: 120_000,
      taskId: "server-task",
      goalId: "server-goal",
    });
  });

  it("reports a paused server session with no open segment", () => {
    const server = dormantSession({ accumulatedMs: 90_000, goalId: "server-goal" });
    expect(resolveEffectiveTimer(server, idleLocal)).toEqual({
      status: "paused",
      startedAt: null,
      pausedElapsedMs: 90_000,
      taskId: null,
      goalId: "server-goal",
    });
  });

  it("never lets an unreadable number or timestamp reach the clock", () => {
    // Both are live cases: `accumulatedMs` has arrived absent (rendering the
    // ring as NaN:NaN:NaN), and an unparseable segmentStartedAt would do the
    // same via `now - NaN`.
    const server = dormantSession({
      status: "RUNNING",
      segmentStartedAt: "not-a-date",
      accumulatedMs: undefined as unknown as number,
    });
    expect(resolveEffectiveTimer(server, idleLocal)).toEqual({
      status: "running",
      startedAt: null,
      pausedElapsedMs: 0,
      taskId: null,
      goalId: null,
    });
  });
});

describe("activeSessionElapsedMs", () => {
  const AT = new Date("2026-08-14T09:10:00.000Z");

  it("rolls a running session forward from the server's own clock", () => {
    // elapsedMs was measured at serverTime; AT is ten minutes later.
    const session = dormantSession({
      status: "RUNNING",
      elapsedMs: 60_000,
      serverTime: "2026-08-14T09:00:00.000Z",
    });
    expect(activeSessionElapsedMs(session, AT)).toBe(60_000 + 600_000);
  });

  it("leaves a paused session exactly where it was", () => {
    const session = dormantSession({ elapsedMs: 60_000, serverTime: "2026-08-14T09:00:00.000Z" });
    expect(activeSessionElapsedMs(session, AT)).toBe(60_000);
  });

  it("never runs backwards when the device clock is behind the server's", () => {
    const session = dormantSession({
      status: "RUNNING",
      elapsedMs: 60_000,
      serverTime: "2026-08-14T09:20:00.000Z",
    });
    expect(activeSessionElapsedMs(session, AT)).toBe(60_000);
  });

  it("falls back to accumulatedMs when elapsedMs is missing", () => {
    const session = dormantSession({ elapsedMs: undefined as unknown as number, accumulatedMs: 30_000 });
    expect(activeSessionElapsedMs(session, AT)).toBe(30_000);
  });
});

describe("readStartConflict", () => {
  it("is null for anything that is not a 409", () => {
    // These must NOT be presented to the user as "a timer is already
    // running": offline, a timeout, and the plan's daily-entry refusal.
    expect(readStartConflict(new Error("Network Error"))).toBeNull();
    expect(readStartConflict({ response: { status: 403, data: {} } })).toBeNull();
    expect(readStartConflict(undefined)).toBeNull();
  });

  it("extracts the session the 409 body carries", () => {
    const session = dormantSession({ status: "RUNNING", accumulatedMs: 5_000 });
    expect(readStartConflict({ response: { status: 409, data: { activeSession: session } } })).toEqual({ session });
  });

  it("is a conflict with no session when the body carries none", () => {
    // The API re-reads the row after the failed insert; it can be gone by then.
    expect(readStartConflict({ response: { status: 409, data: { activeSession: null } } })).toEqual({ session: null });
    expect(readStartConflict({ response: { status: 409, data: {} } })).toEqual({ session: null });
    // Same empty-body-as-'' shape the GET path has to survive.
    expect(readStartConflict({ response: { status: 409, data: { activeSession: "" } } })).toEqual({ session: null });
  });
});

describe("describeStartConflict", () => {
  const AT = new Date("2026-08-14T09:42:00.000Z");

  it("names what is running, for how long, and where", () => {
    const session = dormantSession({
      status: "RUNNING",
      task: { id: "t1", title: "Deep work" },
      elapsedMs: 42 * 60_000,
      serverTime: "2026-08-14T09:42:00.000Z",
      lastClient: "web",
    });
    const description = describeStartConflict(session, AT);
    expect(description).toContain('"Deep work"');
    expect(description).toContain("has been running");
    expect(description).toContain("the web app");
    expect(description).toContain("42m");
  });

  it("degrades gracefully when the session has no name and no known device", () => {
    const session = dormantSession({ accumulatedMs: 30 * 60_000, elapsedMs: 30 * 60_000 });
    const description = describeStartConflict(session, AT);
    expect(description).toContain("A timer");
    expect(description).toContain("is paused");
    expect(description).toContain("another device");
  });

  it("falls back through task, goal, then the session's own free-text name", () => {
    const goalOnly = dormantSession({ goal: { id: "g1", title: "Fitness", color: "#000000" } });
    expect(describeStartConflict(goalOnly, AT)).toContain('"Fitness"');
    const nameOnly = dormantSession({ taskName: "gym" });
    expect(describeStartConflict(nameOnly, AT)).toContain('"gym"');
  });
});
