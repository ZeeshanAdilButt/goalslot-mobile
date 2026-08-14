// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed (nor is
// one being added here — see derive-online.test.ts for the same note), so
// this file is excluded from `tsc --noEmit` via tsconfig.json's `exclude`
// rather than typed against jest's ambient globals.
import {
  goalDeepLink,
  resolveNotificationRoute,
  scheduleDayDeepLink,
  taskDeepLink,
  todayDeepLink,
} from "./deep-links";

describe("todayDeepLink", () => {
  it("points at the app root", () => {
    expect(todayDeepLink()).toBe("goalslot://");
  });
});

describe("goalDeepLink", () => {
  it("resolves to the Goals list, scoped to the goal id", () => {
    expect(goalDeepLink("goal-123")).toBe("goalslot://goals?goalId=goal-123");
  });

  it("encodes ids that need it", () => {
    expect(goalDeepLink("goal 123/456")).toBe("goalslot://goals?goalId=goal%20123%2F456");
  });
});

describe("taskDeepLink", () => {
  it("resolves to the Tasks list, scoped to the task id", () => {
    expect(taskDeepLink("task-abc")).toBe("goalslot://tasks?taskId=task-abc");
  });
});

describe("scheduleDayDeepLink", () => {
  it("resolves to the Schedule tab, scoped to the day of week", () => {
    expect(scheduleDayDeepLink(0)).toBe("goalslot://schedule?day=0");
    expect(scheduleDayDeepLink(6)).toBe("goalslot://schedule?day=6");
  });
});

describe("resolveNotificationRoute", () => {
  it("routes a 'today' payload to the app root", () => {
    expect(resolveNotificationRoute({ type: "today" })).toBe("/");
  });

  it("routes a 'goal' payload to the Goals list with the goal id", () => {
    expect(resolveNotificationRoute({ type: "goal", id: "goal-1" })).toBe("/goals?goalId=goal-1");
  });

  it("routes a 'task' payload to the Tasks list with the task id", () => {
    expect(resolveNotificationRoute({ type: "task", id: "task-1" })).toBe("/tasks?taskId=task-1");
  });

  it("routes a 'schedule' payload to the Schedule tab with the day", () => {
    expect(resolveNotificationRoute({ type: "schedule", dayOfWeek: 3 })).toBe("/schedule?day=3");
  });

  it("routes a 'journal' payload to the Journal tab", () => {
    expect(resolveNotificationRoute({ type: "journal" })).toBe("/journal");
  });

  // The remote-push case. This payload is minted by goal-slot-api's
  // messaging.service.ts (`{ type: 'conversation', conversationId }`) and
  // arrives verbatim as the Expo message's `data`, so these assertions are
  // the contract with the server — the key is `conversationId`, not `id`.
  it("routes a 'conversation' payload to that conversation's screen", () => {
    expect(resolveNotificationRoute({ type: "conversation", conversationId: "conv-1" })).toBe(
      "/message/conv-1",
    );
  });

  it("escapes a conversation id that isn't URL-safe", () => {
    expect(resolveNotificationRoute({ type: "conversation", conversationId: "a/b?c" })).toBe(
      "/message/a%2Fb%3Fc",
    );
  });

  it("returns null for a 'conversation' payload with no usable id", () => {
    expect(resolveNotificationRoute({ type: "conversation" })).toBeNull();
    expect(resolveNotificationRoute({ type: "conversation", conversationId: "" })).toBeNull();
    expect(resolveNotificationRoute({ type: "conversation", conversationId: 7 })).toBeNull();
  });

  it("returns null for payloads missing required fields", () => {
    expect(resolveNotificationRoute({ type: "goal" })).toBeNull();
    expect(resolveNotificationRoute({ type: "schedule", dayOfWeek: 9 })).toBeNull();
  });

  it("returns null for an unknown type", () => {
    expect(resolveNotificationRoute({ type: "unknown" })).toBeNull();
  });

  it("returns null for non-object or missing payloads", () => {
    expect(resolveNotificationRoute(undefined)).toBeNull();
    expect(resolveNotificationRoute(null)).toBeNull();
    expect(resolveNotificationRoute("goal-1")).toBeNull();
  });
});
