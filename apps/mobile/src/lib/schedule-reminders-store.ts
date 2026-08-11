// Which schedule blocks have their reminder notification turned OFF.
//
// Opt-OUT, not opt-in, and that's deliberate: "I need real alarms and/or
// alerts... for those who don't turn on the alarms, every time a new
// schedule slot is in action" — the only way a silent-by-default reminder
// system reaches someone who never opens a settings toggle is if reminders
// are already on. So a block's reminder is ON unless its id is in this set;
// nothing has to be explicitly enabled for the default case to work.
//
// Only a bare set of ids is persisted here, not the notification content
// itself. Actually scheduling/cancelling the OS-level notification is a side
// effect and belongs in schedule-reminders.ts, which calls into this store's
// plain getters/setters — keeping this file synchronous and trivially
// testable, same separation as timer-store.ts vs useTimerNotification.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface ScheduleRemindersPersistedState {
  disabledBlockIds: string[];
}

interface ScheduleRemindersState extends ScheduleRemindersPersistedState {
  isReminderEnabled: (blockId: string) => boolean;
  setReminderEnabled: (blockId: string, enabled: boolean) => void;
  /** Bulk helper for "turn off all" — adds every id not already present. */
  disableAll: (blockIds: string[]) => void;
  /** Bulk helper for "turn on all" — removes every one of these ids. */
  enableAll: (blockIds: string[]) => void;
}

export const useScheduleRemindersStore = create<ScheduleRemindersState>()(
  persist(
    (set, get) => ({
      disabledBlockIds: [],

      isReminderEnabled(blockId) {
        return !get().disabledBlockIds.includes(blockId);
      },

      setReminderEnabled(blockId, enabled) {
        set((state) => ({
          disabledBlockIds: enabled
            ? state.disabledBlockIds.filter((id) => id !== blockId)
            : state.disabledBlockIds.includes(blockId)
              ? state.disabledBlockIds
              : [...state.disabledBlockIds, blockId],
        }));
      },

      disableAll(blockIds) {
        set((state) => {
          const next = new Set(state.disabledBlockIds);
          for (const id of blockIds) next.add(id);
          return { disabledBlockIds: Array.from(next) };
        });
      },

      enableAll(blockIds) {
        set((state) => {
          const remove = new Set(blockIds);
          return { disabledBlockIds: state.disabledBlockIds.filter((id) => !remove.has(id)) };
        });
      },
    }),
    {
      name: "goalslot-schedule-reminders-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ disabledBlockIds: state.disabledBlockIds }),
    },
  ),
);
