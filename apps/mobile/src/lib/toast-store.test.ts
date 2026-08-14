// No import of `describe`/`it`/`expect`/`jest`: same convention as
// timer-store.test.ts and settings-store.test.ts — Jest injects these as real
// globals, and this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude`.
//
// What's under test is everything about the queue that a user's undo depends
// on but that no rendering test would catch: that an actionable toast is
// given a longer life than a plain one, that its handler runs at most once no
// matter how the button is mashed, and that dismissing a toast throws the
// action away rather than firing it. The store is deliberately where those
// rules live (rather than inside <ToastHost/>) precisely so they can be
// asserted without a renderer — see the header on toast-store.ts.

import {
  MAX_VISIBLE_TOASTS,
  showToast,
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  useToastStore,
} from "./toast-store";

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe("show", () => {
  it("queues a plain toast with its kind and the default duration", () => {
    useToastStore.getState().show("Saved", "success");

    const [toast] = useToastStore.getState().toasts;
    expect(toast.message).toBe("Saved");
    expect(toast.kind).toBe("success");
    expect(toast.action).toBeUndefined();
    expect(toast.durationMs).toBe(TOAST_DURATION_MS);
  });

  it("gives an actionable toast longer to live than a plain one", () => {
    // The point isn't the specific number, it's the relationship: an undo the
    // user can't reach before it disappears is worse than no undo at all.
    expect(TOAST_ACTION_DURATION_MS).toBeGreaterThan(TOAST_DURATION_MS);

    useToastStore.getState().show("Time slot deleted", "success", {
      action: { label: "Undo", onPress: () => undefined },
    });

    const [toast] = useToastStore.getState().toasts;
    expect(toast.action?.label).toBe("Undo");
    expect(toast.durationMs).toBe(TOAST_ACTION_DURATION_MS);
  });

  it("gives same-millisecond toasts distinct ids", () => {
    // A series delete resolves several mutations back to back; duplicate keys
    // would make React drop one of the rendered rows.
    const now = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      useToastStore.getState().show("One", "success");
      useToastStore.getState().show("Two", "success");
    } finally {
      now.mockRestore();
    }

    const [first, second] = useToastStore.getState().toasts;
    expect(first.id).not.toBe(second.id);
  });

  it("keeps only the newest toasts once the stack is full", () => {
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i++) {
      useToastStore.getState().show(`Toast ${i}`, "success");
    }

    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(toasts[0].message).toBe("Toast 2");
    expect(toasts[MAX_VISIBLE_TOASTS - 1].message).toBe(`Toast ${MAX_VISIBLE_TOASTS + 1}`);
  });
});

describe("runAction", () => {
  it("fires the action and retires the toast", () => {
    const onPress = jest.fn();
    useToastStore.getState().show("Time slot deleted", "success", { action: { label: "Undo", onPress } });
    const { id } = useToastStore.getState().toasts[0];

    useToastStore.getState().runAction(id);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("fires at most once even if the button is pressed twice", () => {
    // The real hazard this guards: an undo handler issues network writes
    // (schedule.tsx re-creates every deleted block), so a double-tap on a
    // button that is already animating away would restore duplicates.
    const onPress = jest.fn();
    useToastStore.getState().show("Time slot deleted", "success", { action: { label: "Undo", onPress } });
    const { id } = useToastStore.getState().toasts[0];

    useToastStore.getState().runAction(id);
    useToastStore.getState().runAction(id);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("removes the toast before running the handler", () => {
    // Not incidental ordering: it's what makes the double-tap guard above
    // hold even when the handler itself is slow or re-entrant.
    let queueLengthDuringPress = -1;
    useToastStore.getState().show("Time slot deleted", "success", {
      action: {
        label: "Undo",
        onPress: () => {
          queueLengthDuringPress = useToastStore.getState().toasts.length;
        },
      },
    });

    useToastStore.getState().runAction(useToastStore.getState().toasts[0].id);

    expect(queueLengthDuringPress).toBe(0);
  });

  it("ignores an id that has already expired", () => {
    // The timer in <ToastHost/> and the user's finger race on every toast.
    expect(() => useToastStore.getState().runAction("toast-gone")).not.toThrow();
  });

  it("leaves an actionless toast alone", () => {
    useToastStore.getState().show("Saved", "success");
    const { id } = useToastStore.getState().toasts[0];

    useToastStore.getState().runAction(id);

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe("dismiss", () => {
  it("drops an actionable toast without running its action", () => {
    // Dismiss means "I don't want this" — auto-dismissing an undo toast must
    // never be the same thing as pressing Undo.
    const onPress = jest.fn();
    useToastStore.getState().show("Time slot deleted", "success", { action: { label: "Undo", onPress } });
    const { id } = useToastStore.getState().toasts[0];

    useToastStore.getState().dismiss(id);

    expect(onPress).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("removes only the targeted toast", () => {
    useToastStore.getState().show("One", "success");
    useToastStore.getState().show("Two", "error");
    const [first] = useToastStore.getState().toasts;

    useToastStore.getState().dismiss(first.id);

    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Two");
  });
});

describe("showToast", () => {
  it("forwards kind and action from non-component call sites", () => {
    // The entry point api-client.ts's `notify()` uses — the path every screen
    // actually reaches the queue through.
    const onPress = jest.fn();
    showToast("Time slot deleted", "success", { action: { label: "Undo", onPress } });

    const [toast] = useToastStore.getState().toasts;
    expect(toast.kind).toBe("success");
    expect(toast.durationMs).toBe(TOAST_ACTION_DURATION_MS);
    toast.action?.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("defaults to a success toast", () => {
    showToast("Synced 3 offline changes");

    expect(useToastStore.getState().toasts[0].kind).toBe("success");
  });
});
