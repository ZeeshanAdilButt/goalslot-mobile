// Lightweight in-app toast queue: a zustand store backing <ToastHost/>
// (src/components/ToastHost.tsx).
//
// zustand rather than React context: `showToast` below needs to be callable
// from plain (non-component) code — api-client.ts's `notify()` export and
// offline.ts's `onDropped` hook both run outside any component tree.
//
// A toast can also carry one action (`ToastAction`), which is how destructive
// mutations get an undo without a bespoke per-screen banner: the call site
// already holds the payload it just deleted, so "Undo" is a re-create it can
// hand over as a closure. Everything that makes that safe — the longer life
// an actionable toast gets, and the guarantee its handler fires at most once
// — lives in this store rather than in <ToastHost/>, so it is testable
// without rendering anything.

import { create } from "zustand";

// "offline" is its own kind (not folded into "success") specifically so
// ToastHost can give an offline-queued confirmation a visually distinct
// treatment (wifi-off icon, warning tint) from a true "this actually
// finished" success — the two read as very different events to the user
// even though both are non-error outcomes. The shared sync engine
// (packages/shared/src/offline/sync.ts) only ever emits "success"/"error"
// itself (its own "Synced N offline changes" summary IS a true success);
// call sites that queue something for later (the various "Queued — will
// sync when online" notify() calls) pass "offline" explicitly.
export type ToastKind = "success" | "error" | "offline";

/**
 * A single button rendered inside the toast — in practice always "Undo" on a
 * destructive action whose full payload the call site still has in hand (see
 * schedule.tsx's block delete, which re-`create`s what it just deleted).
 *
 * Deliberately one action, not an array: a toast is a passing notice with
 * room for exactly one escape hatch, and a second button would both crowd a
 * two-line message off the card and force a choice under a countdown.
 */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastEntry {
  id: string;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  /**
   * How long <ToastHost/> should leave this toast up. Resolved here rather
   * than in the component so the "an actionable toast outlives a plain one"
   * rule is a pure, tested fact about the queue instead of a branch buried in
   * a render path — see TOAST_ACTION_DURATION_MS.
   */
  durationMs: number;
}

/** A plain notice: long enough to read, short enough not to linger. */
export const TOAST_DURATION_MS = 4000;

/**
 * An actionable notice. Nearly double, because the read is only the first
 * half of the job: the user has to notice the toast, read it, decide the
 * delete was a mistake, and land a tap on the button — and an undo that
 * expires mid-reach is worse than no undo at all, since it teaches that the
 * button is a lie. Still finite: an undo that never expires is a second
 * permanent control, and it would sit over the FAB indefinitely.
 */
export const TOAST_ACTION_DURATION_MS = 7000;

/**
 * The stack is anchored above the tab bar and grows upward; past three it
 * starts covering real content, and with actionable toasts living ~7s a
 * burst of mutations can genuinely queue that many. Oldest is dropped first
 * — it is both the closest to expiring on its own and the one whose context
 * the user has most likely moved on from.
 */
export const MAX_VISIBLE_TOASTS = 3;

export interface ShowToastOptions {
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastEntry[];
  show: (message: string, kind: ToastKind, options?: ShowToastOptions) => void;
  dismiss: (id: string) => void;
  /** Fires a toast's action and retires it in one step. See below for why both. */
  runAction: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, kind, options) => {
    // Date.now() alone collides when two mutations resolve in the same
    // millisecond (a series delete does exactly this), and duplicate keys in
    // the rendered list would make React drop one of the rows.
    const id = `toast-${Date.now()}-${nextId++}`;
    const entry: ToastEntry = {
      id,
      message,
      kind,
      action: options?.action,
      durationMs: options?.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS,
    };
    set((state) => ({ toasts: [...state.toasts, entry].slice(-MAX_VISIBLE_TOASTS) }));
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  // Removing the toast BEFORE invoking its handler is the whole point of
  // routing the press through the store instead of calling `action.onPress()`
  // in the component and dismissing after: an undo handler issues real
  // network writes (schedule.tsx re-creates every deleted block), and a
  // double-tap — trivially easy on a button that is about to disappear —
  // would otherwise fire it twice and restore duplicates. Once it's out of
  // the queue there is no second entry left to press.
  runAction: (id) => {
    const toast = get().toasts.find((entry) => entry.id === id);
    if (!toast?.action) return;
    set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }));
    toast.action.onPress();
  },
}));

/** Non-hook entry point for call sites outside a component (api-client.ts's `notify`). */
export function showToast(message: string, kind: ToastKind = "success", options?: ShowToastOptions): void {
  useToastStore.getState().show(message, kind, options);
}
