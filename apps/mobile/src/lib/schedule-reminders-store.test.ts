// The three-level reminder hierarchy: master -> series -> block, each of
// which now holds one of three tiers ("off" / "notify" / "alarm") rather than
// a boolean.
//
// Tested against the exported pure transitions and `resolveReminderTier`
// rather than the zustand store, so none of this needs AsyncStorage or
// hydration. The store's actions are one-line wrappers around exactly these
// functions.
//
// The case that matters most is PRECEDENCE: a block's own override always
// wins over its series', which always wins over the master tier — simple
// lookup, no rewriting of a broader entry required (unlike the old
// boolean-and-sets model this replaced).
//
// The bottom `describe("useScheduleRemindersStore", ...)` block exercises the
// real zustand store (actions, not just the pure transitions above), so it
// needs the same AsyncStorage stub timer-store.test.ts uses: the store module
// imports AsyncStorage at load time for its persist middleware, and nothing
// here is testing persistence itself.

import {
  applyBlockTier,
  applyMasterTier,
  applySeriesTier,
  clearBlockTierOverride,
  clearSeriesTierOverride,
  resolveReminderTier,
  useScheduleRemindersStore,
  type ReminderTarget,
  type ScheduleRemindersPersistedState,
} from "./schedule-reminders-store";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

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

const ALARM_STATE: ScheduleRemindersPersistedState = {
  masterTier: "alarm",
  seriesTierOverrides: {},
  blockTierOverrides: {},
};

describe("resolveReminderTier", () => {
  it("is 'alarm' by default — nothing has to be explicitly set", () => {
    for (const target of UNIVERSE) {
      expect(resolveReminderTier(ALARM_STATE, target)).toBe("alarm");
    }
  });

  it("master tier applies to everything when nothing overrides it", () => {
    const state = applyMasterTier(ALARM_STATE, "notify");
    for (const target of UNIVERSE) {
      expect(resolveReminderTier(state, target)).toBe("notify");
    }
  });

  it("a series override wins over the master tier", () => {
    const state = applySeriesTier(ALARM_STATE, READING, "off");
    expect(resolveReminderTier(state, reading(1))).toBe("off");
    expect(resolveReminderTier(state, { id: "gym-0", seriesId: GYM })).toBe("alarm");
  });

  it("a block override wins over its series' override", () => {
    const seriesOff = applySeriesTier(ALARM_STATE, READING, "off");
    const state = applyBlockTier(seriesOff, reading(3), "notify");

    expect(resolveReminderTier(state, reading(3))).toBe("notify");
    // Untouched siblings still inherit the series-level "off".
    expect(resolveReminderTier(state, reading(1))).toBe("off");
  });

  it("a block override wins over the master tier even with no series override", () => {
    const state = applyBlockTier(ALARM_STATE, reading(3), "off");

    expect(resolveReminderTier(state, reading(3))).toBe("off");
    expect(resolveReminderTier(state, reading(1))).toBe("alarm");
  });

  it("every combination of tiers at every level resolves to the most specific one set", () => {
    const state: ScheduleRemindersPersistedState = {
      masterTier: "off",
      seriesTierOverrides: { [READING]: "notify" },
      blockTierOverrides: { "reading-3": "alarm" },
    };

    expect(resolveReminderTier(state, reading(3))).toBe("alarm"); // block wins
    expect(resolveReminderTier(state, reading(1))).toBe("notify"); // series wins
    expect(resolveReminderTier(state, { id: "gym-0", seriesId: GYM })).toBe("off"); // master wins
  });
});

describe("applyMasterTier", () => {
  it("applies to blocks that do not exist yet", () => {
    const next = applyMasterTier(ALARM_STATE, "off");
    const blockAddedLater: ReminderTarget = { id: "brand-new", seriesId: "series-new" };
    expect(resolveReminderTier(next, blockAddedLater)).toBe("off");
  });

  it("does not touch existing series/block overrides — they still take precedence", () => {
    const withOverrides: ScheduleRemindersPersistedState = {
      masterTier: "alarm",
      seriesTierOverrides: { [READING]: "off" },
      blockTierOverrides: { "gym-0": "notify" },
    };

    const next = applyMasterTier(withOverrides, "off");

    expect(next.masterTier).toBe("off");
    expect(resolveReminderTier(next, reading(1))).toBe("off"); // series override unchanged
    expect(resolveReminderTier(next, { id: "gym-0", seriesId: GYM })).toBe("notify"); // block override unchanged
  });
});

describe("applySeriesTier / clearSeriesTierOverride", () => {
  it("covers days that are not in the universe yet", () => {
    const next = applySeriesTier(ALARM_STATE, READING, "off");

    // A sixth Reading day added next week inherits the series' tier rather
    // than starting at the master tier.
    expect(resolveReminderTier(next, { id: "reading-6", seriesId: READING })).toBe("off");
  });

  it("applies to every day of the series at once and leaves other series alone", () => {
    const next = applySeriesTier(ALARM_STATE, READING, "notify");

    expect(resolveReminderTier(next, reading(1))).toBe("notify");
    expect(resolveReminderTier(next, reading(5))).toBe("notify");
    expect(resolveReminderTier(next, { id: "gym-0", seriesId: GYM })).toBe("alarm");
  });

  it("does not clear block overrides beneath it — they're independent map entries", () => {
    const state: ScheduleRemindersPersistedState = {
      masterTier: "alarm",
      seriesTierOverrides: {},
      blockTierOverrides: { "reading-2": "off" },
    };

    const next = applySeriesTier(state, READING, "notify");

    // The block override is a separate, more-specific entry and still wins.
    expect(resolveReminderTier(next, reading(2))).toBe("off");
    expect(resolveReminderTier(next, reading(1))).toBe("notify");
  });

  it("clearing a series override falls back to the master tier", () => {
    const seriesOff = applySeriesTier(ALARM_STATE, READING, "off");
    const next = clearSeriesTierOverride(seriesOff, READING);

    expect(next.seriesTierOverrides[READING]).toBeUndefined();
    expect(resolveReminderTier(next, reading(1))).toBe("alarm");
  });

  it("clearing an override that was never set is a no-op", () => {
    const next = clearSeriesTierOverride(ALARM_STATE, READING);
    expect(next).toEqual(ALARM_STATE);
  });
});

describe("applyBlockTier / clearBlockTierOverride", () => {
  it("sets one day's tier without touching its siblings", () => {
    const next = applyBlockTier(ALARM_STATE, reading(3), "off");

    expect(resolveReminderTier(next, reading(3))).toBe("off");
    expect(resolveReminderTier(next, reading(1))).toBe("alarm");
    expect(resolveReminderTier(next, reading(2))).toBe("alarm");
  });

  it("overrides a series tier for exactly one day, leaving the rest of the series alone", () => {
    const seriesOff = applySeriesTier(ALARM_STATE, READING, "off");
    const next = applyBlockTier(seriesOff, reading(3), "alarm");

    expect(resolveReminderTier(next, reading(3))).toBe("alarm");
    expect(resolveReminderTier(next, reading(1))).toBe("off");
    // The series override itself is untouched — no rewriting needed.
    expect(next.seriesTierOverrides[READING]).toBe("off");
  });

  it("round-trips: setting then clearing a block override returns the original resolution", () => {
    const withOverride = applyBlockTier(ALARM_STATE, reading(3), "off");
    const restored = clearBlockTierOverride(withOverride, reading(3));

    expect(resolveReminderTier(restored, reading(3))).toBe(resolveReminderTier(ALARM_STATE, reading(3)));
    expect(restored.blockTierOverrides["reading-3"]).toBeUndefined();
  });

  it("re-setting the same block's tier replaces rather than duplicates the entry", () => {
    const once = applyBlockTier(ALARM_STATE, reading(3), "off");
    const twice = applyBlockTier(once, reading(3), "notify");

    expect(twice.blockTierOverrides).toEqual({ "reading-3": "notify" });
  });

  it("clearing falls back through to a series override, not straight to master", () => {
    const seriesOff = applySeriesTier(ALARM_STATE, READING, "off");
    const withBlockOverride = applyBlockTier(seriesOff, reading(3), "alarm");

    const next = clearBlockTierOverride(withBlockOverride, reading(3));

    expect(resolveReminderTier(next, reading(3))).toBe("off");
  });
});

describe("useScheduleRemindersStore", () => {
  beforeEach(() => {
    useScheduleRemindersStore.getState().reset();
  });

  it("defaults to masterTier 'alarm' with no overrides", () => {
    const state = useScheduleRemindersStore.getState();
    expect(state.masterTier).toBe("alarm");
    expect(state.seriesTierOverrides).toEqual({});
    expect(state.blockTierOverrides).toEqual({});
  });

  it("setMasterTier / setSeriesTier / setBlockTier update the store and resolution follows precedence", () => {
    const store = useScheduleRemindersStore.getState();

    store.setMasterTier("notify");
    store.setSeriesTier(READING, "off", UNIVERSE);
    store.setBlockTier(reading(3), "alarm", UNIVERSE);

    const state = useScheduleRemindersStore.getState();
    expect(resolveReminderTier(state, reading(3))).toBe("alarm");
    expect(resolveReminderTier(state, reading(1))).toBe("off");
    expect(resolveReminderTier(state, { id: "gym-0", seriesId: GYM })).toBe("notify");
  });

  it("clearSeriesOverride / clearBlockOverride drop the override entirely", () => {
    const store = useScheduleRemindersStore.getState();
    store.setSeriesTier(READING, "off", UNIVERSE);
    store.setBlockTier(reading(2), "off", UNIVERSE);

    store.clearBlockOverride(reading(2));
    expect(useScheduleRemindersStore.getState().blockTierOverrides["reading-2"]).toBeUndefined();
    expect(resolveReminderTier(useScheduleRemindersStore.getState(), reading(2))).toBe("off"); // still series-off

    store.clearSeriesOverride(READING);
    expect(useScheduleRemindersStore.getState().seriesTierOverrides[READING]).toBeUndefined();
    expect(resolveReminderTier(useScheduleRemindersStore.getState(), reading(2))).toBe("alarm"); // falls to master
  });

  it("reset() restores the default state", () => {
    const store = useScheduleRemindersStore.getState();
    store.setMasterTier("off");
    store.setSeriesTier(READING, "notify", UNIVERSE);

    store.reset();

    const state = useScheduleRemindersStore.getState();
    expect(state.masterTier).toBe("alarm");
    expect(state.seriesTierOverrides).toEqual({});
    expect(state.blockTierOverrides).toEqual({});
  });
});
