// Local device settings (theme preference, tracking-reminder interval).
// Persisted via AsyncStorage following the exact same pattern as
// src/lib/timer-store.ts — this is app-layer device state, not something the
// API or another platform needs to know about, and not sensitive, so plain
// AsyncStorage persistence (rather than expo-secure-store, which is reserved
// for auth tokens per src/providers/auth-provider.tsx) is the right call.
//
// The reminder interval lives HERE rather than on timer-store, even though
// web keeps its equivalent on the timer store (dw-time-web's
// use-timer-store.ts): it is a standing preference, not session state, and
// timer-store's stop() — which session-reset.ts calls on every sign-in and
// sign-out — resets that store wholesale back to INITIAL_STATE. Parking the
// interval there would silently reset the user's choice to 15 minutes every
// time they signed in. It is device-scoped rather than account-scoped for
// the same reason theme is, and for the same reason web's copy is: web
// persists it to localStorage, so it is already per-device there too.
//
// Theme is deliberately just "the user's stored preference" right now.
// There is no app-wide theme system implemented yet (no ThemeProvider, no
// component reads this value to actually change colors) — wiring live theme
// switching across every screen is out of scope for the Settings screen
// itself. This store exists so the choice survives app restarts and is
// ready for a future theme system to read, per the Settings screen's note
// to the user that the choice takes effect on next launch.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_REMINDER_INTERVAL_MINUTES, normalizeReminderIntervalMinutes } from "./timer-reminders";

export type ThemePreference = "light" | "dark" | "system";

interface SettingsPersistedState {
  themePreference: ThemePreference;
  /** How often the running timer nudges "still strictly focused?", in minutes. */
  timerReminderIntervalMinutes: number;
}

interface SettingsState extends SettingsPersistedState {
  setThemePreference: (preference: ThemePreference) => void;
  setTimerReminderIntervalMinutes: (minutes: number) => void;
}

const INITIAL_STATE: SettingsPersistedState = {
  themePreference: "system",
  timerReminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setThemePreference(preference) {
        set({ themePreference: preference });
      },

      setTimerReminderIntervalMinutes(minutes) {
        // Normalised on the way in as well as on the way out (the scheduler
        // does the same) so a bad value can never reach storage in the first
        // place.
        set({ timerReminderIntervalMinutes: normalizeReminderIntervalMinutes(minutes) });
      },
    }),
    {
      name: "goalslot-settings-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        themePreference: state.themePreference,
        timerReminderIntervalMinutes: state.timerReminderIntervalMinutes,
      }),
      // Storage written before this field existed rehydrates it as
      // `undefined`, which would otherwise reach the picker as "no option
      // selected" and the scheduler as a normalise-to-default every pass.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SettingsPersistedState>),
        timerReminderIntervalMinutes: normalizeReminderIntervalMinutes(
          (persisted as Partial<SettingsPersistedState> | undefined)?.timerReminderIntervalMinutes,
        ),
      }),
    },
  ),
);
