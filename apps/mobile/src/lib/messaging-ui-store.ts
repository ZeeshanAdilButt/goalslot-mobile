// Unsent composer text, per conversation. Pure device-local view state, same
// reasoning as notes-ui-store.ts: it is not the server's business, and it is
// account-scoped so session-reset.ts clears it.
//
// It exists because losing a half-typed message is one of the most annoying
// things a chat app can do, and on a phone it happens constantly: the thread
// screen is a tab (see app/(app)/_layout.tsx), so switching to Today and back
// re-renders it, and a notification tap or the OS reclaiming memory can drop
// component state entirely. Persisting through AsyncStorage means the draft
// survives all three, plus an app restart.
//
// Drafts are stored keyed by conversation id and deleted on successful send,
// so this doesn't grow without bound.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface MessagingUiState {
  drafts: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
  /** Sign-out only: these drafts belong to one account's conversations. */
  reset: () => void;
}

export const useMessagingUiStore = create<MessagingUiState>()(
  persist(
    (set, get) => ({
      drafts: {},

      setDraft(conversationId, text) {
        const { drafts } = get();
        if (text.length === 0) {
          // Storing "" would keep an entry alive for every thread the user
          // ever opened and typed into.
          if (!(conversationId in drafts)) return;
          const { [conversationId]: _removed, ...rest } = drafts;
          set({ drafts: rest });
          return;
        }
        if (drafts[conversationId] === text) return;
        set({ drafts: { ...drafts, [conversationId]: text } });
      },

      clearDraft(conversationId) {
        const { drafts } = get();
        if (!(conversationId in drafts)) return;
        const { [conversationId]: _removed, ...rest } = drafts;
        set({ drafts: rest });
      },

      reset() {
        set({ drafts: {} });
      },
    }),
    {
      name: "goalslot-messaging-ui-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);
