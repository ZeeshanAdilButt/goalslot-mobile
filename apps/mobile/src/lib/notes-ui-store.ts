// Which notes have their subpages collapsed in the Notes tree. Pure device-
// local view state, same reasoning as timer-store.ts: the server already has
// a per-note `isExpanded` flag, but that one is shared with the web app and
// mutating it on every chevron tap would spam the API for something that is
// really "how this phone last displayed the list". Persisted via AsyncStorage
// (zustand persist, matching timer-store.ts) so the tree reopens the way the
// user left it.
//
// Stored as a string[] rather than a Set because zustand's JSON storage
// can't serialize a Set; screens that need fast lookups build a Set from it
// (memoized on the array identity, which only changes on actual toggles).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface NotesUiState {
  collapsedIds: string[];
  toggleCollapsed: (noteId: string) => void;
  /** Ensure a note renders expanded (no-op when it already is). Used after
   *  dropping/creating something inside it so the result is visible. */
  expand: (noteId: string) => void;
}

export const useNotesUiStore = create<NotesUiState>()(
  persist(
    (set, get) => ({
      collapsedIds: [],

      toggleCollapsed(noteId) {
        const { collapsedIds } = get();
        set({
          collapsedIds: collapsedIds.includes(noteId)
            ? collapsedIds.filter((id) => id !== noteId)
            : [...collapsedIds, noteId],
        });
      },

      expand(noteId) {
        const { collapsedIds } = get();
        if (!collapsedIds.includes(noteId)) return;
        set({ collapsedIds: collapsedIds.filter((id) => id !== noteId) });
      },
    }),
    {
      name: "goalslot-notes-ui-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ collapsedIds: state.collapsedIds }),
    },
  ),
);
