// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed (nor is one
// being added here — see deep-links.test.ts / derive-online.test.ts for the
// same note), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
import {
  runNotificationTap,
  shouldHandleNotificationTap,
  type NotificationTapHandlers,
} from "./notification-tap";

function spyHandlers() {
  const calls: Array<[string, string?]> = [];
  const handlers: NotificationTapHandlers = {
    navigate: (href) => calls.push(["navigate", href]),
    openUrl: (url) => calls.push(["openUrl", url]),
    checkForUpdate: () => calls.push(["checkForUpdate"]),
  };
  return { calls, handlers };
}

describe("runNotificationTap", () => {
  // The regression this file exists for. APP_RELEASE ("a new app update is
  // available") is the one notification type whose action is never a
  // `navigate`, and the notification center used to resolve taps through
  // `resolveNotificationRoute` — a navigation-only view that returns `null`
  // for exactly these two cases. Tapping the row marked it read and did
  // nothing else, so the update prompt silently destroyed itself.
  describe("release notifications (the APP_RELEASE regression)", () => {
    it("checks for an OTA update when the release carries no URL", () => {
      const { calls, handlers } = spyHandlers();

      const kind = runNotificationTap({ type: "release" }, handlers);

      expect(kind).toBe("check-for-update");
      expect(calls).toEqual([["checkForUpdate"]]);
    });

    it("opens the release URL when one is supplied", () => {
      const { calls, handlers } = spyHandlers();

      const kind = runNotificationTap(
        { type: "release", url: "https://goalslot.io/releases/1-2-0" },
        handlers,
      );

      expect(kind).toBe("open-url");
      expect(calls).toEqual([["openUrl", "https://goalslot.io/releases/1-2-0"]]);
    });

    it("falls back to an update check rather than opening a non-https URL", () => {
      const { calls, handlers } = spyHandlers();

      const kind = runNotificationTap(
        { type: "release", url: "javascript:alert(1)" },
        handlers,
      );

      expect(kind).toBe("check-for-update");
      expect(calls).toEqual([["checkForUpdate"]]);
    });
  });

  describe("navigating types", () => {
    it("routes a task notification to the task", () => {
      const { calls, handlers } = spyHandlers();

      const kind = runNotificationTap({ type: "task", id: "task-1" }, handlers);

      expect(kind).toBe("navigate");
      expect(calls).toEqual([["navigate", "/tasks?taskId=task-1"]]);
    });

    it("routes a conversation notification to the conversation", () => {
      const { calls, handlers } = spyHandlers();

      const kind = runNotificationTap(
        { type: "conversation", conversationId: "conv-1" },
        handlers,
      );

      expect(kind).toBe("navigate");
      expect(calls[0]?.[0]).toBe("navigate");
    });
  });

  describe("unrecognised payloads", () => {
    // An older build receiving a notification type a newer server added must
    // quietly do nothing, not throw and not fire an unrelated handler.
    it.each([
      ["an unknown type", { type: "something-new" }],
      ["a missing type", {}],
      ["null", null],
      ["a string", "release"],
    ])("returns null and fires no handler for %s", (_label, data) => {
      const { calls, handlers } = spyHandlers();

      expect(runNotificationTap(data, handlers)).toBeNull();
      expect(calls).toEqual([]);
    });
  });
});

describe("shouldHandleNotificationTap", () => {
  // Every case below is a real ordering observed against this repo's own
  // expo-router in a react-test-renderer probe, not a hypothetical.
  const base = {
    status: "authenticated" as const,
    isRestoring: false,
    responseId: "notif-1" as string | null,
    handledId: null as string | null,
  };

  it("dispatches once the app is signed in and the cache has restored", () => {
    expect(shouldHandleNotificationTap(base)).toBe(true);
  });

  it("does nothing when there is no notification response at all", () => {
    expect(shouldHandleNotificationTap({ ...base, responseId: null })).toBe(false);
  });

  it("waits while auth is still resolving", () => {
    expect(shouldHandleNotificationTap({ ...base, status: "loading" })).toBe(false);
  });

  // THE REPORTED BUG. The old guard was `status === "loading"` only, so a
  // cold-start tap while signed out pushed the conversation route straight
  // into (app)/_layout's redirect-to-login, which ate it. After signing in
  // the user landed on Today and the message they tapped was gone. Holding
  // the tap until 'authenticated' is what lets it survive the login detour.
  it("holds the tap while signed out instead of feeding it to the login redirect", () => {
    expect(shouldHandleNotificationTap({ ...base, status: "unauthenticated" })).toBe(false);
  });

  it("waits for the persisted query cache to finish restoring", () => {
    expect(shouldHandleNotificationTap({ ...base, isRestoring: true })).toBe(false);
  });

  // The effect's deps include `status`, so any later auth transition (a
  // session refresh, or signing out and back in) re-ran it against the SAME
  // `lastNotificationResponse`. Nothing marked the response consumed, so the
  // user got yanked into a conversation they'd tapped hours earlier.
  it("fires at most once per notification, across later auth transitions", () => {
    expect(shouldHandleNotificationTap({ ...base, handledId: "notif-1" })).toBe(false);
  });

  it("still fires for a genuinely new notification after an earlier one", () => {
    expect(shouldHandleNotificationTap({ ...base, responseId: "notif-2", handledId: "notif-1" })).toBe(
      true,
    );
  });
});
