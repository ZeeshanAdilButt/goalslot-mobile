// Local device settings (currently: theme preference only). Persisted via
// AsyncStorage following the exact same pattern as src/lib/timer-store.ts —
// this is app-layer device state, not something the API or another platform
// needs to know about, and not sensitive, so plain AsyncStorage persistence
// (rather than expo-secure-store, which is reserved for auth tokens per
// src/providers/auth-provider.tsx) is the right call.
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

export type ThemePreference = "light" | "dark" | "system";

interface SettingsPersistedState {
  themePreference: ThemePreference;
}

interface SettingsState extends SettingsPersistedState {
  setThemePreference: (preference: ThemePreference) => void;
}

const INITIAL_STATE: SettingsPersistedState = {
  themePreference: "system",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setThemePreference(preference) {
        set({ themePreference: preference });
      },
    }),
    {
      name: "goalslot-settings-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        themePreference: state.themePreference,
      }),
    },
  ),
);
