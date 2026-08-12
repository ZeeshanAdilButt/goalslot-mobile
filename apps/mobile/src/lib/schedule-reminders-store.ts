// Which schedule blocks have their alarm turned OFF, at three levels of
// granularity: everything, one series, one block.
//
// Opt-OUT, not opt-in, and that's deliberate: "I need real alarms and/or
// alerts... for those who don't turn on the alarms, every time a new
// schedule slot is in action" — the only way a silent-by-default reminder
// system reaches someone who never opens a settings toggle is if reminders
// are already on. So a block's alarm is ON unless something switched it off;
// nothing has to be explicitly enabled for the default case to work.
//
// WHY THREE LEVELS. "turn off all alarms, or the alarms for a series of
// schedule blocks" is two different asks, and neither is expressible as a
// set of block ids:
//
//   - A master switch has to be STICKY. The previous implementation's
//     "disable all" just bulk-added every currently-known block id, so the
//     next block the user created came back ON — the switch silently undid
//     itself. A master switch is one boolean, not a snapshot.
//   - Silencing "Reading" has to silence the whole series, including days
//     the user hasn't looked at, and has to keep applying if a day is added
//     to that series later. Again: not a snapshot of ids.
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

export interface ScheduleRemindersPersistedState {
  /** Master switch. False silences every schedule alarm, now and in future. */
  masterEnabled: boolean;
  /** Series whose alarms are off — applies to days not yet loaded, and to days added later. */
  disabledSeriesIds: string[];
  /** Individual blocks switched off inside an otherwise-on series. */
  disabledBlockIds: string[];
}

/**
 * Resolution is a plain AND down the hierarchy: a block alarms only if the
 * master is on, its series isn't silenced, and it isn't silenced itself.
 */
export function resolveReminderEnabled(
  state: ScheduleRemindersPersistedState,
  target: ReminderTarget,
): boolean {
  if (!state.masterEnabled) return false;
  if (state.disabledSeriesIds.includes(target.seriesId)) return false;
  return !state.disabledBlockIds.includes(target.id);
}

// ---------------------------------------------------------------------------
// Transitions
//
// Turning something ON has to be able to escape a broader OFF above it, or
// the switch is dead: a user who hits the master off, then opens "Reading"
// and flips its toggle on, must get Reading back — not a switch that visibly
// moves and changes nothing. A dead switch on an alarms screen means a missed
// alarm, so the rule is explicit:
//
//   Turning ON at a level DEMOTES any OFF above it — the broader OFF is
//   rewritten as the equivalent set of OFFs one level down, minus the branch
//   being turned on — and CLEARS every OFF below it.
//
// Turning OFF is just the plain thing: record the OFF at that level.
//
// Every demotion is exact, not approximate, because the "universe" of blocks
// really is knowable: a schedule is one week (WeekSchedule is keyed 0-6), so
// the caller can always hand over every block there is.
// ---------------------------------------------------------------------------

function without<T>(list: readonly T[], remove: ReadonlySet<T>): T[] {
  return list.filter((item) => !remove.has(item));
}

function withAll<T>(list: readonly T[], add: readonly T[]): T[] {
  return Array.from(new Set([...list, ...add]));
}

/** Rewrites `masterEnabled: false` as "every series except this one is off". */
function demoteMaster(
  state: ScheduleRemindersPersistedState,
  keepSeriesId: string,
  universe: readonly ReminderTarget[],
): ScheduleRemindersPersistedState {
  if (state.masterEnabled) return state;
  const otherSeriesIds = Array.from(
    new Set(universe.map((t) => t.seriesId).filter((id) => id !== keepSeriesId)),
  );
  return {
    ...state,
    masterEnabled: true,
    disabledSeriesIds: withAll(state.disabledSeriesIds, otherSeriesIds),
  };
}

/** Rewrites "this series is off" as "every block in it except this one is off". */
function demoteSeries(
  state: ScheduleRemindersPersistedState,
  keepBlockId: string,
  seriesId: string,
  universe: readonly ReminderTarget[],
): ScheduleRemindersPersistedState {
  if (!state.disabledSeriesIds.includes(seriesId)) return state;
  const siblingIds = universe
    .filter((t) => t.seriesId === seriesId && t.id !== keepBlockId)
    .map((t) => t.id);
  return {
    ...state,
    disabledSeriesIds: without(state.disabledSeriesIds, new Set([seriesId])),
    disabledBlockIds: withAll(state.disabledBlockIds, siblingIds),
  };
}

export function applyMasterEnabled(
  state: ScheduleRemindersPersistedState,
  enabled: boolean,
): ScheduleRemindersPersistedState {
  // "Turn everything on" means exactly that — the levels below are cleared
  // rather than left to re-silence something the moment the master comes back.
  if (enabled) return { masterEnabled: true, disabledSeriesIds: [], disabledBlockIds: [] };
  return { ...state, masterEnabled: false };
}

export function applySeriesEnabled(
  state: ScheduleRemindersPersistedState,
  seriesId: string,
  enabled: boolean,
  universe: readonly ReminderTarget[],
): ScheduleRemindersPersistedState {
  if (!enabled) {
    return { ...state, disabledSeriesIds: withAll(state.disabledSeriesIds, [seriesId]) };
  }
  const demoted = demoteMaster(state, seriesId, universe);
  const memberIds = new Set(universe.filter((t) => t.seriesId === seriesId).map((t) => t.id));
  return {
    ...demoted,
    disabledSeriesIds: without(demoted.disabledSeriesIds, new Set([seriesId])),
    // Clear the level below: turning the whole series on can't leave one of
    // its days still individually muted.
    disabledBlockIds: without(demoted.disabledBlockIds, memberIds),
  };
}

export function applyBlockEnabled(
  state: ScheduleRemindersPersistedState,
  target: ReminderTarget,
  enabled: boolean,
  universe: readonly ReminderTarget[],
): ScheduleRemindersPersistedState {
  if (!enabled) {
    return { ...state, disabledBlockIds: withAll(state.disabledBlockIds, [target.id]) };
  }
  const afterMaster = demoteMaster(state, target.seriesId, universe);
  const afterSeries = demoteSeries(afterMaster, target.id, target.seriesId, universe);
  return {
    ...afterSeries,
    disabledBlockIds: without(afterSeries.disabledBlockIds, new Set([target.id])),
  };
}

const INITIAL_STATE: ScheduleRemindersPersistedState = {
  masterEnabled: true,
  disabledSeriesIds: [],
  disabledBlockIds: [],
};

interface ScheduleRemindersState extends ScheduleRemindersPersistedState {
  isReminderEnabled: (target: ReminderTarget) => boolean;
  isSeriesEnabled: (seriesId: string) => boolean;
  setMasterEnabled: (enabled: boolean) => void;
  setSeriesEnabled: (seriesId: string, enabled: boolean, universe: readonly ReminderTarget[]) => void;
  setBlockEnabled: (target: ReminderTarget, enabled: boolean, universe: readonly ReminderTarget[]) => void;
  /**
   * Drop every stored preference. For sign-out only (see session-reset.ts):
   * these are one account's schedule-block and series ids and mean nothing
   * under another.
   */
  reset: () => void;
}

export const useScheduleRemindersStore = create<ScheduleRemindersState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      isReminderEnabled(target) {
        return resolveReminderEnabled(get(), target);
      },

      isSeriesEnabled(seriesId) {
        const state = get();
        return state.masterEnabled && !state.disabledSeriesIds.includes(seriesId);
      },

      setMasterEnabled(enabled) {
        set((state) => applyMasterEnabled(state, enabled));
      },

      setSeriesEnabled(seriesId, enabled, universe) {
        set((state) => applySeriesEnabled(state, seriesId, enabled, universe));
      },

      setBlockEnabled(target, enabled, universe) {
        set((state) => applyBlockEnabled(state, target, enabled, universe));
      },

      reset() {
        set({ ...INITIAL_STATE });
      },
    }),
    {
      name: "goalslot-schedule-reminders-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        masterEnabled: state.masterEnabled,
        disabledSeriesIds: state.disabledSeriesIds,
        disabledBlockIds: state.disabledBlockIds,
      }),
      // v0 persisted only `disabledBlockIds`. Zustand's default merge is a
      // shallow spread of persisted-over-initial, so the two new keys would
      // already fall back to their defaults — but that is an implementation
      // detail of the middleware to be relying on for a switch whose failure
      // mode is "alarms the user turned off start firing again". Spelling the
      // migration out makes the intent survive a zustand upgrade: keep the
      // per-block opt-outs the user already made, default the rest to on.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<ScheduleRemindersPersistedState>;
        if (version >= 1) return { ...INITIAL_STATE, ...state };
        return {
          ...INITIAL_STATE,
          disabledBlockIds: Array.isArray(state.disabledBlockIds) ? state.disabledBlockIds : [],
        };
      },
    },
  ),
);
