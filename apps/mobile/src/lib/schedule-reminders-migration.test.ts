// The AsyncStorage upgrade path from the old boolean disabled-sets shape
// (masterEnabled/disabledSeriesIds/disabledBlockIds) to the new tri-state
// override model (masterTier/seriesTierOverrides/blockTierOverrides).
//
// Real installs have data in the OLD shape sitting in AsyncStorage right
// now, so this has to be lossless: nobody's existing on/off choice may
// change or reset just because the app upgraded.

import { migrateSchedulePersistedState } from "./schedule-reminders-store";

describe("migrateSchedulePersistedState", () => {
  describe("from the v1 boolean shape", () => {
    it("maps masterEnabled: true to masterTier: 'alarm'", () => {
      const next = migrateSchedulePersistedState(
        { masterEnabled: true, disabledSeriesIds: [], disabledBlockIds: [] },
        1,
      );

      expect(next.masterTier).toBe("alarm");
    });

    it("maps masterEnabled: false to masterTier: 'off'", () => {
      const next = migrateSchedulePersistedState(
        { masterEnabled: false, disabledSeriesIds: [], disabledBlockIds: [] },
        1,
      );

      expect(next.masterTier).toBe("off");
    });

    it("maps every disabled series id to an 'off' override, losslessly", () => {
      const next = migrateSchedulePersistedState(
        {
          masterEnabled: true,
          disabledSeriesIds: ["series-reading", "series-gym"],
          disabledBlockIds: [],
        },
        1,
      );

      expect(next.seriesTierOverrides).toEqual({
        "series-reading": "off",
        "series-gym": "off",
      });
    });

    it("maps every disabled block id to an 'off' override, losslessly", () => {
      const next = migrateSchedulePersistedState(
        {
          masterEnabled: true,
          disabledSeriesIds: [],
          disabledBlockIds: ["block-1", "block-2"],
        },
        1,
      );

      expect(next.blockTierOverrides).toEqual({
        "block-1": "off",
        "block-2": "off",
      });
    });

    it("preserves a realistic mixed installation exactly", () => {
      const next = migrateSchedulePersistedState(
        {
          masterEnabled: true,
          disabledSeriesIds: ["series-reading"],
          disabledBlockIds: ["block-standalone"],
        },
        1,
      );

      expect(next).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: { "series-reading": "off" },
        blockTierOverrides: { "block-standalone": "off" },
      });
    });

    it("a master-off install keeps its series/block overrides as additional 'off' entries", () => {
      const next = migrateSchedulePersistedState(
        {
          masterEnabled: false,
          disabledSeriesIds: ["series-reading"],
          disabledBlockIds: ["block-1"],
        },
        1,
      );

      // Nothing here re-derives a "these are redundant under master-off"
      // simplification — that would be a rewrite, exactly what the new
      // override-map model exists to avoid. Preserving them verbatim is
      // strictly lossless, and resolution already handles the redundancy.
      expect(next).toEqual({
        masterTier: "off",
        seriesTierOverrides: { "series-reading": "off" },
        blockTierOverrides: { "block-1": "off" },
      });
    });
  });

  describe("from the v0 shape (disabledBlockIds only)", () => {
    it("carries the disabled block ids forward and defaults everything else to on", () => {
      const next = migrateSchedulePersistedState({ disabledBlockIds: ["legacy-block"] }, 0);

      expect(next).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: {},
        blockTierOverrides: { "legacy-block": "off" },
      });
    });

    it("tolerates a missing or malformed disabledBlockIds", () => {
      expect(migrateSchedulePersistedState({}, 0)).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: {},
        blockTierOverrides: {},
      });
      expect(migrateSchedulePersistedState(null, 0)).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: {},
        blockTierOverrides: {},
      });
      expect(migrateSchedulePersistedState({ disabledBlockIds: "not-an-array" }, 0)).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: {},
        blockTierOverrides: {},
      });
    });
  });

  describe("already on the v2 tri-state shape", () => {
    it("passes tri-state data through unchanged", () => {
      const alreadyMigrated = {
        masterTier: "notify" as const,
        seriesTierOverrides: { "series-reading": "off" as const },
        blockTierOverrides: { "block-1": "alarm" as const },
      };

      expect(migrateSchedulePersistedState(alreadyMigrated, 2)).toEqual(alreadyMigrated);
    });

    it("fills in missing fields with defaults rather than throwing on a sparse v2 blob", () => {
      expect(migrateSchedulePersistedState({ masterTier: "off" }, 2)).toEqual({
        masterTier: "off",
        seriesTierOverrides: {},
        blockTierOverrides: {},
      });
    });

    it("defaults a totally empty persisted value to the same shape a fresh install gets", () => {
      expect(migrateSchedulePersistedState({}, 2)).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: {},
        blockTierOverrides: {},
      });
      expect(migrateSchedulePersistedState(null, 2)).toEqual({
        masterTier: "alarm",
        seriesTierOverrides: {},
        blockTierOverrides: {},
      });
    });
  });
});
