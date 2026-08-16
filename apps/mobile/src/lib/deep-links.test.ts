// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed (nor is
// one being added here — see derive-online.test.ts for the same note), so
// this file is excluded from `tsc --noEmit` via tsconfig.json's `exclude`
// rather than typed against jest's ambient globals.
import {
  goalDeepLink,
  parseScheduleDayParam,
  resolveNotificationAction,
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

describe("parseScheduleDayParam", () => {
  // app/(app)/schedule.tsx uses this to seed its initial day from
  // `/schedule?day=N`. Previously the screen didn't read `day` at all, so a
  // schedule-block alarm tapped on a different weekday than the block
  // opened on today's day instead of the block's — this is that fix's
  // parsing logic, isolated and tested directly.
  it("parses each valid day string", () => {
    expect(parseScheduleDayParam("0")).toBe(0);
    expect(parseScheduleDayParam("6")).toBe(6);
    expect(parseScheduleDayParam("3")).toBe(3);
  });

  it("returns null for an absent, out-of-range, or non-numeric value", () => {
    expect(parseScheduleDayParam(undefined)).toBeNull();
    expect(parseScheduleDayParam("7")).toBeNull();
    expect(parseScheduleDayParam("-1")).toBeNull();
    expect(parseScheduleDayParam("not-a-day")).toBeNull();
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

  // Regression: an empty-string id used to pass validation and resolve to
  // "/goals?goalId=" / "/tasks?taskId=" instead of being rejected, the same
  // "" vs. absent gap already guarded against on the conversation branch above.
  it("returns null for a 'goal' or 'task' payload with an empty id", () => {
    expect(resolveNotificationRoute({ type: "goal", id: "" })).toBeNull();
    expect(resolveNotificationRoute({ type: "task", id: "" })).toBeNull();
  });

  it("returns null for an unknown type", () => {
    expect(resolveNotificationRoute({ type: "unknown" })).toBeNull();
  });

  it("returns null for non-object or missing payloads", () => {
    expect(resolveNotificationRoute(undefined)).toBeNull();
    expect(resolveNotificationRoute(null)).toBeNull();
    expect(resolveNotificationRoute("goal-1")).toBeNull();
  });

  // goal-slot-api's INSTRUCTION_ASSIGNED push (both the immediate notify on
  // assign and the daily stale-instruction sweep) — `{ type: 'instruction',
  // instructionId }` verbatim. Previously "instruction" wasn't a member of
  // the union at all, so this fell through to `null` (no navigation) on
  // every tap regardless of platform.
  it("routes an 'instruction' payload to the Instructions screen with the instruction id", () => {
    expect(resolveNotificationRoute({ type: "instruction", instructionId: "instr-1" })).toBe(
      "/instructions?instructionId=instr-1",
    );
  });

  it("returns null for an 'instruction' payload with no usable id", () => {
    expect(resolveNotificationRoute({ type: "instruction" })).toBeNull();
    expect(resolveNotificationRoute({ type: "instruction", instructionId: "" })).toBeNull();
  });

  // goal-slot-api's SHARED_REPORT_UNVIEWED push (reminder-dispatch.service.ts's
  // sweepStaleReports) reuses the literal tag "schedule" — the same tag the
  // LOCAL schedule-block alarm uses — but carries `sharedAccessId` instead
  // of `dayOfWeek`. Previously this didn't structurally match the
  // `dayOfWeek`-only "schedule" member, so it fell through to `null` on
  // every tap. It's disambiguated by which field is actually present, not
  // by the tag (both are "schedule").
  it("routes a 'schedule' payload carrying sharedAccessId (not dayOfWeek) to the Sharing list", () => {
    expect(resolveNotificationRoute({ type: "schedule", sharedAccessId: "share-1" })).toBe("/mentees");
  });

  it("still routes a local schedule-alarm 'schedule' payload (dayOfWeek) to its day, not Sharing", () => {
    expect(resolveNotificationRoute({ type: "schedule", dayOfWeek: 5 })).toBe("/schedule?day=5");
  });

  it("returns null for a 'schedule' payload with neither dayOfWeek nor sharedAccessId", () => {
    expect(resolveNotificationRoute({ type: "schedule" })).toBeNull();
    expect(resolveNotificationRoute({ type: "schedule", sharedAccessId: "" })).toBeNull();
  });

  it("routes a 'journal' payload carrying a date to that entry", () => {
    expect(resolveNotificationRoute({ type: "journal", date: "2026-08-01" })).toBe("/journal?date=2026-08-01");
  });

  it("routes a 'journal' payload with no date to today's entry, same as before", () => {
    expect(resolveNotificationRoute({ type: "journal" })).toBe("/journal");
  });
});

describe("resolveNotificationAction", () => {
  it("wraps every in-app-route case in a 'navigate' action, matching resolveNotificationRoute", () => {
    expect(resolveNotificationAction({ type: "today" })).toEqual({ kind: "navigate", href: "/" });
    expect(resolveNotificationAction({ type: "conversation", conversationId: "conv-1" })).toEqual({
      kind: "navigate",
      href: "/message/conv-1",
    });
  });

  // Forward-looking: no backend NotificationType dispatches "release" yet
  // (that's a goal-slot-api change out of this repo's scope), but the
  // client-side contract is settled now so a future server push already
  // routes correctly the day it ships.
  it("opens an https release URL externally rather than as an in-app route", () => {
    expect(resolveNotificationAction({ type: "release", url: "https://github.com/goalslot/releases/v2" })).toEqual({
      kind: "open-url",
      url: "https://github.com/goalslot/releases/v2",
    });
  });

  it("falls back to checking for an OTA update when a 'release' payload carries no URL", () => {
    expect(resolveNotificationAction({ type: "release" })).toEqual({ kind: "check-for-update" });
  });

  it("falls back to checking for an OTA update rather than opening a non-https URL", () => {
    expect(resolveNotificationAction({ type: "release", url: "javascript:alert(1)" })).toEqual({
      kind: "check-for-update",
    });
    expect(resolveNotificationAction({ type: "release", url: "goalslot://goals" })).toEqual({
      kind: "check-for-update",
    });
  });

  it("returns null for a 'release' payload with a non-string url", () => {
    expect(resolveNotificationAction({ type: "release", url: 7 })).toBeNull();
  });
});
