// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed (nor is one
// being added here — see deep-links.test.ts / derive-online.test.ts for the
// same note), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
import { runNotificationTap, type NotificationTapHandlers } from "./notification-tap";

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
