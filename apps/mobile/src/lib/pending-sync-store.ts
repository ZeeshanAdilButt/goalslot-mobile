// Mirrors the shared offline-sync engine's live outbox count
// (packages/shared/src/offline/sync.ts's `onPendingCountChange` callback,
// wired up in src/lib/offline.ts) into a tiny zustand store so any component
// — today, only <ConnectivityPill/> — can read "how many changes are
// waiting to sync" without offline.ts's `offlineSync` instance being threaded
// through props. Not persisted: it's a pure reflection of
// `outbox.getOutboxCount()`, which `offlineSync.refreshPendingCount()` /
// `.init()` already keep current across app restarts and every drain.

import { create } from "zustand";

interface PendingSyncCountState {
  count: number;
  setCount: (count: number) => void;
}

export const usePendingSyncCount = create<PendingSyncCountState>()((set) => ({
  count: 0,
  setCount: (count) => set({ count }),
}));
