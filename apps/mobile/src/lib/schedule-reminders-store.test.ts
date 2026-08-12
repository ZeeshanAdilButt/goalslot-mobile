// The three-level alarm hierarchy: master -> series -> block.
//
// Tested against the exported pure transitions rather than the zustand store,
// so none of this needs AsyncStorage or hydration. The store's actions are
// one-line wrappers around exactly these functions.
//
// The cases that matter are the DEMOTIONS. Turning something on inside a
// broader "off" is where a naive AND-only model produces a switch that
// visibly moves and changes nothing — and on an alarms screen, a dead switch
// is a missed alarm.

import {
  applyBlockEnabled,
  applyMasterEnabled,
  applySeriesEnabled,
  resolveReminderEnabled,
  type ReminderTarget,
  type ScheduleRemindersPersistedState,
} from "./schedule-reminders-store";

// "Reading" on Mon-Fri (one series), plus a standalone Sunday block.
const READING = "series-reading";
const GYM = "series-gym";

const reading = (day: number): ReminderTarget => ({ id: `reading-${day}`, seriesId: READING });
const UNIVERSE: ReminderTarget[] = [
  reading(1),
  reading(2),
  reading(3),
  reading(4),
  reading(5),
  { id: "gym-0", seriesId: GYM },
];

const ON: ScheduleRemindersPersistedState = {
  masterEnabled: true,
  disabledSeriesIds: [],
  disabledBlockIds: [],
};

/** Every target that would actually alarm in the given state. */
function ringing(state: ScheduleRemindersPersistedState): string[] {
  return UNIVERSE.filter((t) => resolveReminderEnabled(state, t)).map((t) => t.id);
}

describe("resolveReminderEnabled", () => {
  it("is on by default — nothing has to be explicitly enabled", () => {
    expect(ringing(ON)).toEqual(UNIVERSE.map((t) => t.id));
  });

  it("is off when the master is off, whatever the levels below say", () => {
    expect(ringing({ ...ON, masterEnabled: false })).toEqual([]);
  });

  it("is off for every member of a silenced series", () => {
    expect(ringing({ ...ON, disabledSeriesIds: [READING] })).toEqual(["gym-0"]);
  });

  it("is off for an individually silenced block only", () => {
    expect(ringing({ ...ON, disabledBlockIds: ["reading-3"] })).toEqual([
      "reading-1",
      "reading-2",
      "reading-4",
      "reading-5",
      "gym-0",
    ]);
  });
});

describe("applyMasterEnabled", () => {
  it("silences everything, including blocks that do not exist yet", () => {
    const next = applyMasterEnabled(ON, false);

    expect(next.masterEnabled).toBe(false);
    // The point of a boolean rather than a snapshot of ids: a block created
    // after the switch was thrown is still silenced.
    const blockAddedLater: ReminderTarget = { id: "brand-new", seriesId: "series-new" };
    expect(resolveReminderEnabled(next, blockAddedLater)).toBe(false);
  });

  it("turning the master back on clears every level below it", () => {
    const muted: ScheduleRemindersPersistedState = {
      masterEnabled: false,
      disabledSeriesIds: [READING],
      disabledBlockIds: ["gym-0"],
    };

    const next = applyMasterEnabled(muted, true);

    expect(ringing(next)).toEqual(UNIVERSE.map((t) => t.id));
  });
});

describe("applySeriesEnabled", () => {
  it("silencing a series covers days that are not in the universe yet", () => {
    const next = applySeriesEnabled(ON, READING, false, UNIVERSE);

    // A sixth Reading day added next week inherits the series' off state
    // rather than starting on.
    expect(resolveReminderEnabled(next, { id: "reading-6", seriesId: READING })).toBe(false);
  });

  it("silences every day of the series at once and leaves other series alone", () => {
    const next = applySeriesEnabled(ON, READING, false, UNIVERSE);

    expect(ringing(next)).toEqual(["gym-0"]);
  });

  it("re-enabling a series clears per-day mutes inside it", () => {
    const state: ScheduleRemindersPersistedState = {
      masterEnabled: true,
      disabledSeriesIds: [READING],
      disabledBlockIds: ["reading-2", "gym-0"],
    };

    const next = applySeriesEnabled(state, READING, true, UNIVERSE);

    // All five Reading days ring; the unrelated gym mute is untouched.
    expect(ringing(next)).toEqual(["reading-1", "reading-2", "reading-3", "reading-4", "reading-5"]);
  });

  it("DEMOTES a master-off rather than being a dead switch", () => {
    const allMuted: ScheduleRemindersPersistedState = { ...ON, masterEnabled: false };

    const next = applySeriesEnabled(allMuted, READING, true, UNIVERSE);

    // Reading comes back, and nothing else does — the master-off has been
    // rewritten as "every OTHER series is off".
    expect(next.masterEnabled).toBe(true);
    expect(ringing(next)).toEqual(["reading-1", "reading-2", "reading-3", "reading-4", "reading-5"]);
  });
});

describe("applyBlockEnabled", () => {
  it("silences one day without touching its siblings", () => {
    const next = applyBlockEnabled(ON, reading(3), false, UNIVERSE);

    expect(ringing(next)).toEqual(["reading-1", "reading-2", "reading-4", "reading-5", "gym-0"]);
  });

  it("DEMOTES a series-off so one day can be exempted from it", () => {
    const seriesMuted = applySeriesEnabled(ON, READING, false, UNIVERSE);

    const next = applyBlockEnabled(seriesMuted, reading(3), true, UNIVERSE);

    // Only Wednesday escapes; the rest of Reading stays silent.
    expect(ringing(next)).toEqual(["reading-3", "gym-0"]);
    expect(next.disabledSeriesIds).not.toContain(READING);
  });

  it("DEMOTES a master-off through BOTH levels for a single block", () => {
    const everythingOff: ScheduleRemindersPersistedState = {
      masterEnabled: false,
      disabledSeriesIds: [READING],
      disabledBlockIds: [],
    };

    const next = applyBlockEnabled(everythingOff, reading(3), true, UNIVERSE);

    expect(next.masterEnabled).toBe(true);
    expect(ringing(next)).toEqual(["reading-3"]);
  });

  it("round-trips: muting then unmuting a block returns the original picture", () => {
    const muted = applyBlockEnabled(ON, reading(3), false, UNIVERSE);
    const restored = applyBlockEnabled(muted, reading(3), true, UNIVERSE);

    expect(ringing(restored)).toEqual(ringing(ON));
  });

  it("never records the same id twice", () => {
    const once = applyBlockEnabled(ON, reading(3), false, UNIVERSE);
    const twice = applyBlockEnabled(once, reading(3), false, UNIVERSE);

    expect(twice.disabledBlockIds).toEqual(["reading-3"]);
  });
});
