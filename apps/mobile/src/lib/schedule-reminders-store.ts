// What each schedule block's reminder is set to, at three levels of
// granularity: everything, one series, one block. Three tiers now, not two:
// "off" (nothing), "notify" (a quiet, still-audible notice), or "alarm"
// (today's loud, DND-piercing behavior).
//
// Opt-OUT, not opt-in, and that's deliberate: "I need real alarms and/or
// alerts... for those who don't turn on the alarms, every time a new
// schedule slot is in action" — the only way a silent-by-default reminder
// system reaches someone who never opens a settings toggle is if reminders
// are already on. So a block's reminder defaults to "alarm" unless something
// set it to something else; nothing has to be explicitly enabled for the
// default case to work.
//
// WHY THREE LEVELS OF GRANULARITY (master / series / block). "turn off all
// reminders, or the reminders for a series of schedule blocks" is two
// different asks, and neither is expressible as a set of block ids:
//
//   - A master switch has to be STICKY. Bulk-recording every currently-known
//     block id would mean the next block the user creates comes back ON —
//     the switch would silently undo itself. A master tier is one value, not
//     a snapshot.
//   - Silencing "Reading" has to silence the whole series, including days
//     the user hasn't looked at, and has to keep applying if a day is added
//     to that series later. Again: not a snapshot of ids.
//
// WHY AN EXPLICIT OVERRIDE MAP INSTEAD OF THE OLD DISABLED-SETS-WITH-DEMOTION
// MODEL. The previous shape (masterEnabled/disabledSeriesIds/disabledBlockIds,
// boolean-only) had to rewrite a broader OFF into an equivalent set of
// narrower OFFs every time something below it turned ON, or the switch that
// visibly moved would change nothing — a dead switch on an alarms screen
// means a missed alarm. With three tiers instead of two, that demote-and-
// rewrite machinery does not generalise cleanly (there is no single "the
// opposite of off" to expand into). An explicit override map sidesteps the
// whole problem: each level just records its own most-specific answer, and
// resolution is a lookup with most-specific-wins, not a rewrite. A block
// override of "alarm" simply outranks a series override of "off" by lookup
// order — nothing above it has to change.
//
// Only the three bare pieces of state are persisted here, never the
// notification content. Actually scheduling/cancelling the OS-level
// notification is a side effect and belongs in schedule-reminders.ts, which
// calls into this store's plain getters/setters — keeping this file
// synchronous and trivially testable, same separation as timer-store.ts vs
// useTimerNotification.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The minimum a caller has to know about a block for this store to place it
 * in the hierarchy. Deliberately not `ScheduleBlock`: nothing here needs the
 * title or the times, and narrowing it keeps the store's tests free of
 * fixture noise.
 */
export interface ReminderTarget {
  id: string;
  seriesId: string;
}

/** Off = nothing. Notify = quiet, still-audible. Alarm = today's loud, DND-piercing behavior. */
export type ReminderTier = "off" | "notify" | "alarm";

export interface ScheduleRemindersPersistedState {
  /** Master tier. Applies to every block, now and in future, unless overridden below. */
  masterTier: ReminderTier;
  /** seriesId -> explicit override. Applies to days not yet loaded, and to days added later. */
  seriesTierOverrides: Record<string, ReminderTier>;
  /** blockId -> explicit override. Wins over any series or master tier. */
  blockTierOverrides: Record<string, ReminderTier>;
}

/**
 * Most-specific-wins: a block's own override beats its series' override,
 * which beats the master tier. No AND-ing, no demotion — the override map
 * already holds the final answer at whichever level someone last touched.
 */
export function resolveReminderTier(
  state: ScheduleRemindersPersistedState,
  target: ReminderTarget,
): ReminderTier {
  return state.blockTierOverrides[target.id] ?? state.seriesTierOverrides[target.seriesId] ?? state.masterTier;
}

function withOverride<T extends Record<string, ReminderTier>>(overrides: T, key: string, tier: ReminderTier): T {
  return { ...overrides, [key]: tier };
}

function withoutOverride<T extends Record<string, ReminderTier>>(overrides: T, key: string): T {
  if (!(key in overrides)) return overrides;
  const next = { ...overrides };
  delete next[key];
  return next;
}

export function applyMasterTier(
  state: ScheduleRemindersPersistedState,
  tier: ReminderTier,
): ScheduleRemindersPersistedState {
  return { ...state, masterTier: tier };
}

export function applySeriesTier(
  state: ScheduleRemindersPersistedState,
  seriesId: string,
  tier: ReminderTier,
): ScheduleRemindersPersistedState {
  return { ...state, seriesTierOverrides: withOverride(state.seriesTierOverrides, seriesId, tier) };
}

/** Drops the series override entirely, falling back to inheriting the master tier. */
export function clearSeriesTierOverride(
  state: ScheduleRemindersPersistedState,
  seriesId: string,
): ScheduleRemindersPersistedState {
  return { ...state, seriesTierOverrides: withoutOverride(state.seriesTierOverrides, seriesId) };
}

export function applyBlockTier(
  state: ScheduleRemindersPersistedState,
  target: ReminderTarget,
  tier: ReminderTier,
): ScheduleRemindersPersistedState {
  return { ...state, blockTierOverrides: withOverride(state.blockTierOverrides, target.id, tier) };
}

/** Drops the block override entirely, falling back to inheriting the series (or master) tier. */
export function clearBlockTierOverride(
  state: ScheduleRemindersPersistedState,
  target: ReminderTarget,
): ScheduleRemindersPersistedState {
  return { ...state, blockTierOverrides: withoutOverride(state.blockTierOverrides, target.id) };
}

const INITIAL_STATE: ScheduleRemindersPersistedState = {
  masterTier: "alarm",
  seriesTierOverrides: {},
  blockTierOverrides: {},
};

interface ScheduleRemindersState extends ScheduleRemindersPersistedState {
  reminderTierFor: (target: ReminderTarget) => ReminderTier;
  seriesTierFor: (seriesId: string) => ReminderTier;
  setMasterTier: (tier: ReminderTier) => void;
  /** `universe` is accepted for interface symmetry with the block/series setters, though this override doesn't need it to resolve inheritance. */
  setSeriesTier: (seriesId: string, tier: ReminderTier, universe: readonly ReminderTarget[]) => void;
  clearSeriesOverride: (seriesId: string) => void;
  setBlockTier: (target: ReminderTarget, tier: ReminderTier, universe: readonly ReminderTarget[]) => void;
  clearBlockOverride: (target: ReminderTarget) => void;
  /**
   * Drop every stored preference. For sign-out only (see session-reset.ts):
   * these are one account's schedule-block and series ids and mean nothing
   * under another.
   */
  reset: () => void;
}

/** Old (pre-tri-state) persisted shape, kept only so `migrate` can read it. */
interface LegacyPersistedStateV1 {
  masterEnabled: boolean;
  disabledSeriesIds: string[];
  disabledBlockIds: string[];
}

function isLegacyShape(state: unknown): state is Partial<LegacyPersistedStateV1> {
  if (state === null || typeof state !== "object") return false;
  return "masterEnabled" in state || "disabledSeriesIds" in state || "disabledBlockIds" in state;
}

/** A string array read back from untyped storage, or `[]` for anything else — never trusted blind. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Converts the old boolean disabled-sets shape into the new tri-state
 * override maps, losslessly: nobody's existing on/off choice should change
 * or reset because of this upgrade.
 *
 *   masterEnabled: false -> masterTier: "off";  true -> "alarm"
 *   each id in disabledSeriesIds/disabledBlockIds -> an "off" override
 *
 * `legacy` comes straight from AsyncStorage's untyped JSON, so every field is
 * revalidated here rather than trusted at the type level — a v0 install only
 * ever had `disabledBlockIds`, and a corrupted or hand-edited blob could hand
 * either array field back as anything at all (a string, for instance, which
 * is itself iterable character-by-character and would otherwise silently
 * produce one bogus override per character).
 */
function migrateFromLegacyV1(legacy: Partial<LegacyPersistedStateV1>): ScheduleRemindersPersistedState {
  const seriesTierOverrides: Record<string, ReminderTier> = {};
  for (const seriesId of asStringArray(legacy.disabledSeriesIds)) {
    seriesTierOverrides[seriesId] = "off";
  }
  const blockTierOverrides: Record<string, ReminderTier> = {};
  for (const blockId of asStringArray(legacy.disabledBlockIds)) {
    blockTierOverrides[blockId] = "off";
  }
  return {
    masterTier: legacy.masterEnabled === false ? "off" : "alarm",
    seriesTierOverrides,
    blockTierOverrides,
  };
}

/**
 * zustand persist's `migrate` function, pulled out to a standalone export so
 * a test can call it directly against a raw AsyncStorage-shaped payload
 * without going through hydration. `version` is whatever `state.version` a
 * real persisted blob on disk carries (or `0`, zustand's default, for a blob
 * from before this store had a `version` field at all).
 *
 * Losslessness is the whole point: nobody's existing on/off choice should
 * change or reset because of this upgrade.
 */
export function migrateSchedulePersistedState(
  persisted: unknown,
  version: number,
): ScheduleRemindersPersistedState {
  if (version >= 2) {
    const state = (persisted ?? {}) as Partial<ScheduleRemindersPersistedState>;
    return {
      masterTier: state.masterTier ?? INITIAL_STATE.masterTier,
      seriesTierOverrides: state.seriesTierOverrides ?? {},
      blockTierOverrides: state.blockTierOverrides ?? {},
    };
  }
  // v0 persisted only `disabledBlockIds`; v1 added `masterEnabled` and
  // `disabledSeriesIds`. Both funnel through the same conversion — a v0 blob
  // simply has nothing for the fields v1 introduced, and `asStringArray` /
  // the `=== false` check above already treat "missing" the same as "empty"
  // / "on".
  return migrateFromLegacyV1(isLegacyShape(persisted) ? persisted : {});
}

export const useScheduleRemindersStore = create<ScheduleRemindersState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      reminderTierFor(target) {
        return resolveReminderTier(get(), target);
      },

      seriesTierFor(seriesId) {
        const state = get();
        return state.seriesTierOverrides[seriesId] ?? state.masterTier;
      },

      setMasterTier(tier) {
        set((state) => applyMasterTier(state, tier));
      },

      setSeriesTier(seriesId, tier) {
        set((state) => applySeriesTier(state, seriesId, tier));
      },

      clearSeriesOverride(seriesId) {
        set((state) => clearSeriesTierOverride(state, seriesId));
      },

      setBlockTier(target, tier) {
        set((state) => applyBlockTier(state, target, tier));
      },

      clearBlockOverride(target) {
        set((state) => clearBlockTierOverride(state, target));
      },

      reset() {
        set({ ...INITIAL_STATE });
      },
    }),
    {
      name: "goalslot-schedule-reminders-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        masterTier: state.masterTier,
        seriesTierOverrides: state.seriesTierOverrides,
        blockTierOverrides: state.blockTierOverrides,
      }),
      // v0 persisted only `disabledBlockIds`. v1 added `masterEnabled` +
      // `disabledSeriesIds` with a boolean-and-sets model. v2 replaces all
      // three with the tri-state override model above. Every prior shape is
      // migrated forward explicitly rather than trusting zustand's default
      // shallow-merge-over-initial: on a switch whose failure mode is
      // "reminders the user turned off start firing again", relying on an
      // implementation detail of the persist middleware to paper over a
      // shape change is not good enough.
      version: 2,
      migrate: migrateSchedulePersistedState,
    },
  ),
);
