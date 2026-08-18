// Local device settings. Persisted via AsyncStorage following the exact same
// pattern as src/lib/timer-store.ts — this is app-layer device state, not
// something the API or another platform needs to know about, and not
// sensitive, so plain AsyncStorage persistence (rather than expo-secure-store,
// which is reserved for auth tokens per src/providers/auth-provider.tsx) is
// the right call.
//
// Everything here has to earn its place by actually changing app behaviour.
// A "theme preference" used to live here too, and it did not: nothing read
// it, so the Settings screen shipped a segmented control that saved a value
// and changed nothing, under a note telling the user so. It has been removed
// rather than left to rot — web made the same call, hiding its Appearance tab
// (see dw-time-web/src/app/dashboard/settings/page.tsx's TABS comment). If a
// real theme system ever lands, the preference comes back with it.
//
// The reminder interval lives HERE rather than on timer-store, even though
// web keeps its equivalent on the timer store (dw-time-web's
// use-timer-store.ts): it is a standing preference, not session state, and
// timer-store's stop() — which session-reset.ts calls on every sign-in and
// sign-out — resets that store wholesale back to INITIAL_STATE. Parking the
// interval there would silently reset the user's choice to 15 minutes every
// time they signed in. It is device-scoped rather than account-scoped for
// the same reason web's copy is: web persists it to localStorage, so it is
// already per-device there too.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_JOURNAL_REMINDER_HOUR, normalizeJournalReminderHour } from "./journal-reminders";
import { DEFAULT_TASK_DIGEST_HOURS, normalizeTaskDigestHours } from "./task-digest-reminders";
import { DEFAULT_REMINDER_INTERVAL_MINUTES, normalizeReminderIntervalMinutes } from "./timer-reminders";

interface SettingsPersistedState {
  /** How often the running timer nudges "still strictly focused?", in minutes. */
  timerReminderIntervalMinutes: number;
  /** Whether the once-daily "you haven't journaled today" nudge is armed. On by default, mirroring schedule alarms. */
  journalReminderEnabled: boolean;
  /** Local hour (0-23, whole hours only) the journal reminder fires at, when armed. */
  journalReminderHour: number;
  /**
   * Whether the "N tasks due today" digest is armed. On by default: this
   * replaces the old always-on per-task due-date reminder (see
   * task-digest-reminders.ts's header), so an upgrading install should keep
   * getting due-today nudges rather than silently losing them.
   */
  taskDigestEnabled: boolean;
  /** Local hours (0-23, whole hours only, sorted ascending, deduped) the due-today digest fires at, when armed. */
  taskDigestHours: number[];
}

interface SettingsState extends SettingsPersistedState {
  setTimerReminderIntervalMinutes: (minutes: number) => void;
  setJournalReminderEnabled: (enabled: boolean) => void;
  setJournalReminderHour: (hour: number) => void;
  setTaskDigestEnabled: (enabled: boolean) => void;
  setTaskDigestHours: (hours: number[]) => void;
}

const INITIAL_STATE: SettingsPersistedState = {
  timerReminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
  journalReminderEnabled: true,
  journalReminderHour: DEFAULT_JOURNAL_REMINDER_HOUR,
  taskDigestEnabled: true,
  taskDigestHours: DEFAULT_TASK_DIGEST_HOURS,
};

/**
 * Rebuilds state from whatever AsyncStorage happens to hold, taking only the
 * keys this store still recognises.
 *
 * Deliberately an explicit pick rather than `{ ...current, ...persisted }`.
 * Installs that ran a build where `themePreference` was still persisted have
 * that key sitting in `goalslot-settings-store` today, and a blind spread
 * would copy it straight back onto live state as a property no type declares
 * and nothing reads. zustand's *default* merge is a shallow spread with the
 * same behaviour — "unknown keys are ignored" is only true of the state
 * shape, not of the object you get back. Picking by name means a retired key
 * cannot survive a rehydrate, and it is dropped from storage entirely on the
 * next write (`partialize` decides what gets written, and it no longer lists
 * it).
 *
 * Exported for src/lib/settings-store.test.ts — the stale-key case is
 * exactly the one that is invisible at runtime until it isn't.
 */
export function mergePersistedSettings(persisted: unknown, current: SettingsState): SettingsState {
  const stored = (persisted ?? {}) as Partial<SettingsPersistedState>;
  return {
    ...current,
    // Storage written before this field existed rehydrates it as `undefined`,
    // which would otherwise reach the picker as "no option selected" and the
    // scheduler as a normalise-to-default every pass.
    timerReminderIntervalMinutes: normalizeReminderIntervalMinutes(stored.timerReminderIntervalMinutes),
    // Same "undefined on upgrade" concern as above: an install that predates
    // this feature has no `journalReminderEnabled` key at all, and `Boolean`
    // coercion would read `undefined` as false — silently opting an existing
    // user out of a feature they've never seen a toggle for. Default to the
    // feature's own default (on) instead, and only trust an explicit boolean.
    journalReminderEnabled:
      typeof stored.journalReminderEnabled === "boolean" ? stored.journalReminderEnabled : true,
    journalReminderHour: normalizeJournalReminderHour(stored.journalReminderHour),
    // Same "undefined on upgrade must not read as off" reasoning as
    // journalReminderEnabled above — this setting replaces the old
    // always-on per-task reminder, so an install that predates it must keep
    // getting due-today nudges, not lose them silently.
    taskDigestEnabled: typeof stored.taskDigestEnabled === "boolean" ? stored.taskDigestEnabled : true,
    taskDigestHours: normalizeTaskDigestHours(stored.taskDigestHours),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setTimerReminderIntervalMinutes(minutes) {
        // Normalised on the way in as well as on the way out (the scheduler
        // does the same) so a bad value can never reach storage in the first
        // place.
        set({ timerReminderIntervalMinutes: normalizeReminderIntervalMinutes(minutes) });
      },

      setJournalReminderEnabled(enabled) {
        set({ journalReminderEnabled: enabled });
      },

      setJournalReminderHour(hour) {
        set({ journalReminderHour: normalizeJournalReminderHour(hour) });
      },

      setTaskDigestEnabled(enabled) {
        set({ taskDigestEnabled: enabled });
      },

      setTaskDigestHours(hours) {
        set({ taskDigestHours: normalizeTaskDigestHours(hours) });
      },
    }),
    {
      name: "goalslot-settings-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        timerReminderIntervalMinutes: state.timerReminderIntervalMinutes,
        journalReminderEnabled: state.journalReminderEnabled,
        journalReminderHour: state.journalReminderHour,
        taskDigestEnabled: state.taskDigestEnabled,
        taskDigestHours: state.taskDigestHours,
      }),
      merge: mergePersistedSettings,
    },
  ),
);
