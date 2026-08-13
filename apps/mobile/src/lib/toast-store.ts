// Lightweight in-app toast queue. This is the "somewhere for it to land"
// api-client.ts's `notify()` didn't have — until now it was `console.warn`
// only (see that file's header comment), so the shared sync engine's
// success/drop messages (packages/shared/src/offline/sync.ts:108-113) and
// the dropped-time-entry hook (src/lib/offline.ts) never reached a real
// user, only a dev console.
//
// No toast/snackbar dependency exists in apps/mobile/package.json, and this
// app has exactly a handful of call sites for one today (sync summaries, a
// dropped-entry notice, quick-add's "queued" confirmation) — not enough to
// justify pulling one in. A zustand queue + <ToastHost/>
// (src/components/ToastHost.tsx) is the whole implementation.
//
// zustand rather than React context: `showToast` below needs to be callable
// from plain (non-component) code — api-client.ts's `notify()` export and
// offline.ts's `onDropped` hook both run outside any component tree.

import { create } from "zustand";

export type ToastKind = "success" | "error";

export interface ToastEntry {
  id: string;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: ToastEntry[];
  show: (message: string, kind: ToastKind) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, kind) => {
    const id = `toast-${Date.now()}-${nextId++}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Non-hook entry point for call sites outside a component (api-client.ts's `notify`). */
export function showToast(message: string, kind: ToastKind = "success"): void {
  useToastStore.getState().show(message, kind);
}
