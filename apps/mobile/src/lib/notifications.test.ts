// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (nor is one being added here — see derive-online.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via
// tsconfig.json's `exclude` rather than typed against jest's ambient
// globals.
import { Platform } from "react-native";

import type { ScheduleBlock } from "@goalslot/shared";

import { createExpoNotificationCapability, resetAlarmChannelCacheForTests } from "./notifications";
import { scheduleBlockReminder } from "./schedule-reminders";

// Jest's module-factory hoisting (babel-plugin-jest-hoist) only allows a
// jest.mock() factory to close over out-of-scope variables whose names start
// with "mock" (case-insensitive) — anything else throws
// "module factory ... not allowed to reference any out-of-scope variables"
// at transform time. Hence the `mock`-prefixed names here instead of the
// bare API names.
const mockRequestPermissionsAsync = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockCancelAllScheduledNotificationsAsync = jest.fn();
const mockDismissAllNotificationsAsync = jest.fn();
const mockGetAllScheduledNotificationsAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();

jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancelScheduledNotificationAsync(...args),
  cancelAllScheduledNotificationsAsync: (...args: unknown[]) =>
    mockCancelAllScheduledNotificationsAsync(...args),
  dismissAllNotificationsAsync: (...args: unknown[]) => mockDismissAllNotificationsAsync(...args),
  getAllScheduledNotificationsAsync: (...args: unknown[]) => mockGetAllScheduledNotificationsAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  SchedulableTriggerInputTypes: { DATE: "date", WEEKLY: "weekly" },
  AndroidNotificationPriority: { MAX: "max", HIGH: "high", DEFAULT: "default", LOW: "low", MIN: "min" },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 0, SECRET: -1 },
}));

describe("createExpoNotificationCapability", () => {
  beforeEach(() => {
    mockRequestPermissionsAsync.mockReset();
    mockGetPermissionsAsync.mockReset();
    mockScheduleNotificationAsync.mockReset();
    mockCancelScheduledNotificationAsync.mockReset();
    mockCancelAllScheduledNotificationsAsync.mockReset();
    mockDismissAllNotificationsAsync.mockReset();
    mockGetAllScheduledNotificationsAsync.mockReset();
    mockSetNotificationChannelAsync.mockReset();
    mockSetNotificationChannelAsync.mockResolvedValue(undefined);
    resetAlarmChannelCacheForTests();
  });

  describe("getPermissionStatus", () => {
    it("reports 'granted' without prompting", async () => {
      mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: false });

      const capability = createExpoNotificationCapability();

      expect(await capability.getPermissionStatus()).toBe("granted");
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("reports 'undetermined' while the OS will still show the prompt", async () => {
      mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });

      const capability = createExpoNotificationCapability();

      expect(await capability.getPermissionStatus()).toBe("undetermined");
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });

    it("reports 'denied' once the OS will no longer ask", async () => {
      // The case that matters for the Settings screen: `granted: false` alone
      // is ambiguous, and offering an in-app "Allow" button here would raise
      // no prompt at all. Only the device settings app can undo this.
      mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

      const capability = createExpoNotificationCapability();

      expect(await capability.getPermissionStatus()).toBe("denied");
    });
  });

  describe("requestPermission", () => {
    it("returns true when the OS grants permission", async () => {
      mockRequestPermissionsAsync.mockResolvedValue({ granted: true });

      const capability = createExpoNotificationCapability();

      expect(await capability.requestPermission()).toBe(true);
    });

    it("returns false when the OS denies permission", async () => {
      mockRequestPermissionsAsync.mockResolvedValue({ granted: false });

      const capability = createExpoNotificationCapability();

      expect(await capability.requestPermission()).toBe(false);
    });
  });

  describe("scheduleNotification", () => {
    it("schedules with a DATE trigger computed from fireAtUtc, using id as the identifier", async () => {
      mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
      mockScheduleNotificationAsync.mockResolvedValue("some-native-id");

      const capability = createExpoNotificationCapability();

      await capability.scheduleNotification({
        id: "reminder-1",
        title: "Time to focus",
        body: "Your block starts now",
        fireAtUtc: "2026-08-08T15:00:00.000Z",
      });

      expect(mockScheduleNotificationAsync).toHaveBeenCalledWith({
        identifier: "reminder-1",
        content: { title: "Time to focus", body: "Your block starts now" },
        trigger: {
          type: "date",
          date: new Date("2026-08-08T15:00:00.000Z"),
        },
      });
    });

    it("requests permission inline when not yet granted but askable", async () => {
      mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
      mockRequestPermissionsAsync.mockResolvedValue({ granted: true });
      mockScheduleNotificationAsync.mockResolvedValue("some-native-id");

      const capability = createExpoNotificationCapability();

      await capability.scheduleNotification({
        id: "reminder-2",
        title: "Title",
        body: "Body",
        fireAtUtc: "2026-08-08T15:00:00.000Z",
      });

      expect(mockRequestPermissionsAsync).toHaveBeenCalled();
      expect(mockScheduleNotificationAsync).toHaveBeenCalled();
    });

    it("no-ops without throwing when permission is denied and cannot be asked again", async () => {
      mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

      const capability = createExpoNotificationCapability();

      await expect(
        capability.scheduleNotification({
          id: "reminder-3",
          title: "Title",
          body: "Body",
          fireAtUtc: "2026-08-08T15:00:00.000Z",
        }),
      ).resolves.toBeUndefined();

      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });

  // THE regression this feature exists for. A reminder that reaches the OS
  // but arrives silently is indistinguishable, to the person holding the
  // phone, from one that was never scheduled — "proper alarms for schedule
  // blocks not working". Everything below asserts the notification is
  // actually loud.
  describe("alarm-grade delivery", () => {
    const originalPlatform = Platform.OS;

    function setPlatform(os: "ios" | "android") {
      Object.defineProperty(Platform, "OS", { value: os, configurable: true });
    }

    afterEach(() => {
      Object.defineProperty(Platform, "OS", { value: originalPlatform, configurable: true });
    });

    async function scheduleAlarm() {
      mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
      mockScheduleNotificationAsync.mockResolvedValue("native-id");
      await createExpoNotificationCapability().scheduleNotification({
        id: "alarm-1",
        title: "Reading",
        body: "Starting now · 6:00 AM",
        repeat: { weekday: 1, hour: 6, minute: 0 },
        alarm: true,
      });
      return mockScheduleNotificationAsync.mock.calls[0][0];
    }

    it("carries a sound — the omission that made every reminder silent", async () => {
      setPlatform("ios");

      const request = await scheduleAlarm();

      // With no `sound` key, expo-notifications' Android builder hits its
      // `!shouldPlaySound && !shouldVibrate` branch and calls
      // `setSilent(true)`, which suppresses the heads-up REGARDLESS of
      // channel importance; on iOS a content without `sound` is a silent
      // banner. This one key is the difference between an alarm and a
      // wordless entry in the shade.
      expect(request.content.sound).toBe("default");
    });

    it("asks iOS to break through Focus with a time-sensitive interruption", async () => {
      setPlatform("ios");

      const request = await scheduleAlarm();

      expect(request.content.interruptionLevel).toBe("timeSensitive");
    });

    it("pins the alarm to a dedicated MAX-importance Android channel", async () => {
      setPlatform("android");

      const request = await scheduleAlarm();

      const [channelId, config] = mockSetNotificationChannelAsync.mock.calls[0];
      expect(config.importance).toBe(5); // AndroidImportance.MAX
      expect(config.sound).toBe("default");
      // The channel id has to ride on the TRIGGER — that is where
      // expo-notifications reads it. On the content it is ignored and the
      // alarm silently lands on the library's fallback channel instead.
      expect(request.trigger.channelId).toBe(channelId);
      // Not the timer's deliberately-quiet channel.
      expect(channelId).not.toBe("goalslot-timer");
    });

    it("creates the channel once, not once per block", async () => {
      setPlatform("android");
      mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
      mockScheduleNotificationAsync.mockResolvedValue("native-id");
      const capability = createExpoNotificationCapability();

      for (const id of ["a", "b", "c"]) {
        await capability.scheduleNotification({
          id,
          title: id,
          body: "",
          repeat: { weekday: 1, hour: 6, minute: 0 },
          alarm: true,
        });
      }

      expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(1);
    });

    it("leaves a non-alarm notification quiet and channel-free", async () => {
      setPlatform("android");
      mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
      mockScheduleNotificationAsync.mockResolvedValue("native-id");

      await createExpoNotificationCapability().scheduleNotification({
        id: "quiet-1",
        title: "Title",
        body: "Body",
        fireAtUtc: "2026-08-08T15:00:00.000Z",
      });

      const request = mockScheduleNotificationAsync.mock.calls[0][0];
      expect(request.content.sound).toBeUndefined();
      expect(request.trigger.channelId).toBeUndefined();
      expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
    });
  });

  describe("cancelNotification", () => {
    it("calls through with the given id", async () => {
      mockCancelScheduledNotificationAsync.mockResolvedValue(undefined);

      const capability = createExpoNotificationCapability();

      await capability.cancelNotification("reminder-1");

      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith("reminder-1");
    });
  });

  describe("listScheduledIds", () => {
    it("returns the identifiers the OS is holding", async () => {
      mockGetAllScheduledNotificationsAsync.mockResolvedValue([
        { identifier: "schedule-reminder-a" },
        { identifier: "goalslot-timer-session" },
      ]);

      const ids = await createExpoNotificationCapability().listScheduledIds();

      expect(ids).toEqual(["schedule-reminder-a", "goalslot-timer-session"]);
    });

    it("reports an empty queue rather than throwing when the platform refuses", async () => {
      mockGetAllScheduledNotificationsAsync.mockRejectedValue(new Error("unavailable"));

      // Callers prune against this list mid-reconcile; a throw here would
      // abort the pass that arms the real alarms.
      await expect(createExpoNotificationCapability().listScheduledIds()).resolves.toEqual([]);
    });
  });

  // The sign-out sweep (see session-reset.ts). Everything here is about a
  // device that changes hands: whatever the previous account queued must not
  // still fire under the next one.
  describe("clearAllNotifications", () => {
    it("empties both the pending queue and the notification shade", async () => {
      mockCancelAllScheduledNotificationsAsync.mockResolvedValue(undefined);
      mockDismissAllNotificationsAsync.mockResolvedValue(undefined);

      const capability = createExpoNotificationCapability();

      await capability.clearAllNotifications();

      // Two distinct queues: cancelling what is pending leaves an
      // already-delivered ongoing timer entry stranded in the shade, and
      // dismissing the shade does nothing to a reminder due next Tuesday.
      expect(mockCancelAllScheduledNotificationsAsync).toHaveBeenCalled();
      expect(mockDismissAllNotificationsAsync).toHaveBeenCalled();
    });

    it("still clears the shade when cancelling the pending queue fails", async () => {
      mockCancelAllScheduledNotificationsAsync.mockRejectedValue(new Error("native module unavailable"));
      mockDismissAllNotificationsAsync.mockResolvedValue(undefined);

      const capability = createExpoNotificationCapability();

      await expect(capability.clearAllNotifications()).resolves.toBeUndefined();
      expect(mockDismissAllNotificationsAsync).toHaveBeenCalled();
    });

    it("resolves rather than throwing when the platform refuses outright", async () => {
      // A rejection here would propagate into the sign-out path. Signing out
      // must not depend on the notification subsystem being healthy.
      mockCancelAllScheduledNotificationsAsync.mockRejectedValue(new Error("boom"));
      mockDismissAllNotificationsAsync.mockRejectedValue(new Error("boom"));

      const capability = createExpoNotificationCapability();

      await expect(capability.clearAllNotifications()).resolves.toBeUndefined();
    });

    it("never asks for permission", async () => {
      // Revoking notification permission stops new notifications being shown;
      // it does not retroactively drop what the OS already accepted. So this
      // has real work to do for a user who granted once and later turned
      // notifications off — and must never re-prompt them on the way out.
      mockCancelAllScheduledNotificationsAsync.mockResolvedValue(undefined);
      mockDismissAllNotificationsAsync.mockResolvedValue(undefined);

      const capability = createExpoNotificationCapability();

      await capability.clearAllNotifications();

      expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });
  });
});

/**
 * The leak this exists to close, end to end: a real schedule-block reminder
 * scheduled through the real capability, then swept, against an
 * expo-notifications fake that actually models the OS queue instead of just
 * recording calls. Asserting on `cancelAllScheduledNotificationsAsync` having
 * been called only proves the app asked; this proves the block's reminder —
 * the one carrying its title — is genuinely no longer pending.
 */
describe("clearAllNotifications against a modelled OS queue", () => {
  const block: ScheduleBlock = {
    id: "block-42",
    title: "Therapy",
    startTime: "18:30",
    endTime: "19:30",
    dayOfWeek: 2,
    category: "Personal",
    color: "#8b5cf6",
    isRecurring: true,
    isPrivate: true,
    seriesId: "series-42",
  };

  /** identifier -> notification content, standing in for the OS's pending list. */
  let pending: Map<string, unknown>;

  beforeEach(() => {
    pending = new Map();
    mockGetPermissionsAsync.mockReset();
    mockScheduleNotificationAsync.mockReset();
    mockCancelAllScheduledNotificationsAsync.mockReset();
    mockDismissAllNotificationsAsync.mockReset();

    mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    mockScheduleNotificationAsync.mockImplementation(async (request: { identifier: string; content: unknown }) => {
      pending.set(request.identifier, request.content);
      return request.identifier;
    });
    mockCancelAllScheduledNotificationsAsync.mockImplementation(async () => {
      pending.clear();
    });
    mockDismissAllNotificationsAsync.mockResolvedValue(undefined);
  });

  it("leaves no trace of a queued schedule-block reminder", async () => {
    const capability = createExpoNotificationCapability();

    await scheduleBlockReminder(block, capability);
    expect(pending.has("schedule-reminder-block-42")).toBe(true);
    // The block's own name is what the next person on the device would have
    // seen pop up, every Tuesday at 18:30, indefinitely.
    expect(JSON.stringify([...pending.values()])).toContain("Therapy");

    await capability.clearAllNotifications();

    expect([...pending.keys()]).toEqual([]);
  });

  it("clears reminders for blocks whose ids the caller no longer knows", async () => {
    // The reason sign-out can't just loop over cancelNotification: by the
    // time it runs, the query cache holding these ids is already gone.
    const capability = createExpoNotificationCapability();

    for (const id of ["a", "b", "c"]) {
      await scheduleBlockReminder({ ...block, id, title: `Block ${id}` }, capability);
    }
    expect(pending.size).toBe(3);

    await capability.clearAllNotifications();

    expect(pending.size).toBe(0);
  });
});
