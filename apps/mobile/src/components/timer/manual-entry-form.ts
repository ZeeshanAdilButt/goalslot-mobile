// The pure half of ManualEntrySheet: what its fields start out as, and what
// they turn into on the wire.
//
// Split out of the component so the two directions can be tested without
// mounting a bottom sheet. The sheet does exactly one interesting thing that
// isn't rendering — it now serves BOTH "log time I forgot to track" (create)
// and "fix a session I already logged" (update) out of one field set — and
// the mapping in each direction is where that gets decided.

import {
  createTimeEntrySchema,
  getLocalDateString,
  getLocalTimeString,
  updateTimeEntrySchema,
  type CreateTimeEntryInput,
  type TimeEntry,
  type UpdateTimeEntryInput,
} from "@goalslot/shared";

export const DEFAULT_DURATION_MIN = 30;

/** Every editable field of the sheet, as the strings its inputs actually hold. */
export interface ManualEntryFormState {
  title: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:mm", local clock. */
  startTime: string;
  /** Free text, not a number — the duration field is a text input the user can empty. */
  durationText: string;
  goalId: string | null;
  taskId: string | null;
}

/** The same fields once validated by the sheet, ready to be turned into a payload. */
export interface ManualEntryFields {
  /** Already trimmed and known non-empty. */
  title: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Full ISO timestamp, built from `date` + the start-time field. */
  startedAt: string;
  /** Minutes, already known to be a finite number >= 1. */
  duration: number;
  goalId: string | null;
  taskId: string | null;
}

/**
 * `UpdateTimeEntryInput` with the three link fields widened to accept an
 * explicit `null`.
 *
 * Zod cannot express "clear this" here: `updateTimeEntrySchema`'s optionals
 * are `string | undefined`, and an `undefined` key is simply dropped from the
 * JSON body — so a parsed payload can only ever ADD a goal/task link, never
 * remove one. Editing has to be able to remove one (the picker's "Just track
 * time" row is right there in the sheet), and the API does accept it:
 * `UpdateTimeEntryDto`'s `@IsOptional()` skips its `@IsUUID()` on an explicit
 * `null` — class-validator treats null as absent — `validateRelations` takes
 * `string | null` and ignores a falsy id, and Prisma writes the null straight
 * through, recomputing the old goal's progress on the way out
 * (goal-slot-api/src/modules/time-entries/time-entries.service.ts#update).
 *
 * So the nullable fields are added AFTER the parse rather than through it,
 * and the one cast back to `UpdateTimeEntryInput` lives at the single
 * `apiClient.timeEntries.update` call site.
 */
export type TimeEntryUpdatePayload = Omit<UpdateTimeEntryInput, "goalId" | "taskId" | "taskTitle"> & {
  goalId?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
};

function startTimeOf(entry: TimeEntry, now: Date): string {
  // An entry with no usable `startedAt` is not something this sheet can
  // invent an answer for, so it falls back to the same "now" a fresh manual
  // entry starts from rather than to a misleading 00:00.
  if (!entry.startedAt) return getLocalTimeString(now);
  const started = new Date(entry.startedAt);
  if (Number.isNaN(started.getTime())) return getLocalTimeString(now);
  return getLocalTimeString(started);
}

/**
 * The sheet's opening state: an empty form for a new entry, or one prefilled
 * from an existing one.
 *
 * `now` is injectable purely so the create-mode defaults are testable without
 * freezing the system clock; every caller in the app leaves it defaulted —
 * the same convention `buildSessionItems` in session-entries.ts follows.
 */
export function buildManualEntryFormState(entry?: TimeEntry | null, now: Date = new Date()): ManualEntryFormState {
  if (!entry) {
    return {
      title: "",
      date: getLocalDateString(now),
      startTime: getLocalTimeString(now),
      durationText: String(DEFAULT_DURATION_MIN),
      goalId: null,
      taskId: null,
    };
  }

  return {
    // Same precedence `sessionEntryTitle` uses, so the field opens showing
    // exactly the text the row the user just tapped was displaying.
    title: entry.taskTitle || entry.taskName || "",
    // The API hands `date` back as a full ISO timestamp rather than the bare
    // "YYYY-MM-DD" it was sent as. Sliced, not re-derived through a Date:
    // that is what `buildSessionItems` does to bucket rows, so this always
    // agrees with the day heading the tapped row was sitting under.
    date: entry.date.slice(0, 10),
    startTime: startTimeOf(entry, now),
    durationText: String(entry.duration),
    goalId: entry.goalId ?? null,
    taskId: entry.taskId ?? null,
  };
}

/**
 * POST body for a brand-new entry. Throws if the shared schema rejects it —
 * the sheet turns that into its inline "check the fields above" error.
 */
export function buildTimeEntryCreate(fields: ManualEntryFields): CreateTimeEntryInput {
  return createTimeEntrySchema.parse({
    taskName: fields.title,
    // taskTitle only travels alongside a real taskId — same convention
    // timer.tsx's handleStop and TrackerVoiceButton's logTime already follow:
    // it's the denormalised snapshot of a REAL task's title, not a second
    // copy of whatever free text the user typed.
    ...(fields.taskId ? { taskId: fields.taskId, taskTitle: fields.title } : {}),
    ...(fields.goalId ? { goalId: fields.goalId } : {}),
    duration: fields.duration,
    date: fields.date,
    startedAt: fields.startedAt,
    notes: "Manual entry",
  });
}

/**
 * PUT body for an entry that already exists.
 *
 * Deliberately says nothing about `notes`: an edit is a correction to the
 * fields this sheet shows, and the create path's own "Manual entry" note (or
 * whatever a live session wrote) is not one of them — sending it would
 * relabel every session the user so much as retitles.
 */
export function buildTimeEntryUpdate(fields: ManualEntryFields): TimeEntryUpdatePayload {
  const validated = updateTimeEntrySchema.parse({
    taskName: fields.title,
    ...(fields.taskId ? { taskId: fields.taskId, taskTitle: fields.title } : {}),
    ...(fields.goalId ? { goalId: fields.goalId } : {}),
    duration: fields.duration,
    date: fields.date,
    startedAt: fields.startedAt,
  });

  return {
    ...validated,
    // Explicit nulls rather than omissions — see TimeEntryUpdatePayload for
    // why these can't go through the parse above.
    ...(fields.goalId ? {} : { goalId: null }),
    // taskTitle is cleared alongside taskId, never on its own: it is a
    // snapshot of a real task's title and `sessionEntryTitle` prefers it over
    // taskName, so leaving it behind would keep the unlinked task's name on
    // the row forever.
    ...(fields.taskId ? {} : { taskId: null, taskTitle: null }),
  };
}
