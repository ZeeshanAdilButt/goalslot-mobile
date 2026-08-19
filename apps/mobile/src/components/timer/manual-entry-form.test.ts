// Cover for ManualEntrySheet's prefill and its two payload shapes.
//
// The prefill cases that matter are the ones that decide whether tapping a
// logged session opens a form the user recognises: the title has to be the
// text the row was showing (taskTitle wins over taskName), the date has to be
// the same day key the row was grouped under even though the API hands `date`
// back as a full ISO timestamp, and the start time has to come out of
// `startedAt` in LOCAL time rather than UTC.
//
// The payload cases exist because create and update disagree in exactly the
// places that are easy to get wrong: an update has to send an explicit `null`
// to DETACH a goal or task (an omitted key is dropped from the body and
// changes nothing), has to drop the stale `taskTitle` snapshot along with the
// taskId, and must not send `notes` at all — a create stamps "Manual entry"
// there, and an edit relabelling every session it touches would be a bug.

import {
  DEFAULT_DURATION_MIN,
  buildManualEntryFormState,
  buildTimeEntryCreate,
  buildTimeEntryUpdate,
  type ManualEntryFields,
} from "./manual-entry-form";

import type { TimeEntry } from "@goalslot/shared";

/** Local-midday Date, so nothing here can drift across a UTC day boundary. */
function localDate(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

function entry(extra: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    taskName: "Deep work",
    date: "2026-08-14",
    duration: 45,
    ...extra,
  };
}

// Real UUIDs: `createTimeEntrySchema`/`updateTimeEntrySchema` validate the
// link ids as uuids, matching CreateTimeEntryDto's own `@IsUUID()`.
const GOAL_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_GOAL_ID = "33333333-3333-4333-8333-333333333333";

function fields(extra: Partial<ManualEntryFields> = {}): ManualEntryFields {
  return {
    title: "Deep work",
    date: "2026-08-14",
    startedAt: localDate(2026, 8, 14, 9, 30).toISOString(),
    duration: 45,
    goalId: null,
    taskId: null,
    ...extra,
  };
}

describe("buildManualEntryFormState", () => {
  const now = localDate(2026, 8, 19, 14, 5);

  it("starts a create empty, dated today, at the current clock time", () => {
    expect(buildManualEntryFormState(undefined, now)).toEqual({
      title: "",
      date: "2026-08-19",
      startTime: "14:05",
      durationText: String(DEFAULT_DURATION_MIN),
      goalId: null,
      taskId: null,
    });
  });

  it("treats a null entry as a create too", () => {
    expect(buildManualEntryFormState(null, now).title).toBe("");
  });

  it("prefills every field from an existing entry", () => {
    const state = buildManualEntryFormState(
      entry({
        taskName: "Deep work",
        duration: 90,
        date: "2026-08-14",
        startedAt: localDate(2026, 8, 14, 8, 5).toISOString(),
        goalId: "goal-1",
        taskId: "task-1",
        taskTitle: "Ship the picker",
      }),
      now,
    );

    expect(state).toEqual({
      title: "Ship the picker",
      date: "2026-08-14",
      startTime: "08:05",
      durationText: "90",
      goalId: "goal-1",
      taskId: "task-1",
    });
  });

  it("falls back to taskName when the entry carries no task snapshot", () => {
    expect(buildManualEntryFormState(entry({ taskName: "Reading" }), now).title).toBe("Reading");
  });

  it("keeps the day key the row was grouped under when date is a full timestamp", () => {
    const state = buildManualEntryFormState(entry({ date: "2026-08-14T00:00:00.000Z" }), now);
    expect(state.date).toBe("2026-08-14");
  });

  it("reads the start time in local time, not UTC", () => {
    const startedAt = localDate(2026, 8, 14, 17, 45).toISOString();
    expect(buildManualEntryFormState(entry({ startedAt }), now).startTime).toBe("17:45");
  });

  it("falls back to the current clock time when startedAt is missing or unusable", () => {
    expect(buildManualEntryFormState(entry({ startedAt: undefined }), now).startTime).toBe("14:05");
    expect(buildManualEntryFormState(entry({ startedAt: "not a date" }), now).startTime).toBe("14:05");
  });
});

describe("buildTimeEntryCreate", () => {
  it("stamps the manual-entry note and omits links that were never picked", () => {
    const payload = buildTimeEntryCreate(fields());

    expect(payload.taskName).toBe("Deep work");
    expect(payload.duration).toBe(45);
    expect(payload.date).toBe("2026-08-14");
    expect(payload.notes).toBe("Manual entry");
    expect(payload.goalId).toBeUndefined();
    expect(payload.taskId).toBeUndefined();
    expect(payload.taskTitle).toBeUndefined();
  });

  it("sends taskTitle only alongside a real taskId", () => {
    const payload = buildTimeEntryCreate(fields({ taskId: TASK_ID, goalId: GOAL_ID }));
    expect(payload.taskId).toBe(TASK_ID);
    expect(payload.taskTitle).toBe("Deep work");
    expect(payload.goalId).toBe(GOAL_ID);
  });
});

describe("buildTimeEntryUpdate", () => {
  it("carries the edited fields through", () => {
    const payload = buildTimeEntryUpdate(fields({ title: "Renamed", duration: 20, date: "2026-08-15" }));

    expect(payload.taskName).toBe("Renamed");
    expect(payload.duration).toBe(20);
    expect(payload.date).toBe("2026-08-15");
    expect(payload.startedAt).toBeDefined();
  });

  it("never sends notes, so an edit can't relabel the session", () => {
    expect(buildTimeEntryUpdate(fields())).not.toHaveProperty("notes");
  });

  it("detaches with an explicit null rather than an omitted key", () => {
    const payload = buildTimeEntryUpdate(fields({ goalId: null, taskId: null }));

    // `toHaveProperty` first: an omitted key would satisfy `toBeNull` only if
    // it were also null, and the whole point is that the key must be PRESENT.
    expect(payload).toHaveProperty("goalId", null);
    expect(payload).toHaveProperty("taskId", null);
    // The stale snapshot goes with the taskId that justified it.
    expect(payload).toHaveProperty("taskTitle", null);
  });

  it("sends the links when they are still set", () => {
    const payload = buildTimeEntryUpdate(fields({ goalId: OTHER_GOAL_ID, taskId: TASK_ID, title: "Renamed" }));

    expect(payload.goalId).toBe(OTHER_GOAL_ID);
    expect(payload.taskId).toBe(TASK_ID);
    expect(payload.taskTitle).toBe("Renamed");
  });

  it("clears only the task when a goal is kept", () => {
    const payload = buildTimeEntryUpdate(fields({ goalId: OTHER_GOAL_ID, taskId: null }));

    expect(payload.goalId).toBe(OTHER_GOAL_ID);
    expect(payload).toHaveProperty("taskId", null);
    expect(payload).toHaveProperty("taskTitle", null);
  });
});
