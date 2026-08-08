// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (nor is one being added here — see derive-online.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via
// tsconfig.json's `exclude` rather than typed against jest's ambient
// globals.
import { createExpoNotificationCapability } from "./notifications";

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

jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancelScheduledNotificationAsync(...args),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

describe("createExpoNotificationCapability", () => {
  beforeEach(() => {
    mockRequestPermissionsAsync.mockReset();
    mockGetPermissionsAsync.mockReset();
    mockScheduleNotificationAsync.mockReset();
    mockCancelScheduledNotificationAsync.mockReset();
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

  describe("cancelNotification", () => {
    it("calls through with the given id", async () => {
      mockCancelScheduledNotificationAsync.mockResolvedValue(undefined);

      const capability = createExpoNotificationCapability();

      await capability.cancelNotification("reminder-1");

      expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith("reminder-1");
    });
  });
});
