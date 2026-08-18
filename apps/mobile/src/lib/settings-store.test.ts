// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see notifications.test.ts and session-reset.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
//
// What's under test is the rehydrate path, not the store's actions. This
// store used to persist a `themePreference` key that has now been removed,
// which means every install that ran an earlier build has a key in
// AsyncStorage that no longer maps to anything. "zustand ignores unknown
// keys" is the kind of claim that is easy to assert and easy to be wrong
// about — zustand's default merge is a shallow spread, which copies unknown
// keys straight onto live state — so it gets a test rather than a comment.

import { DEFAULT_JOURNAL_REMINDER_HOUR } from "./journal-reminders";
import { mergePersistedSettings } from "./settings-store";
import { DEFAULT_TASK_DIGEST_HOURS } from "./task-digest-reminders";
import { DEFAULT_REMINDER_INTERVAL_MINUTES } from "./timer-reminders";

// The store module itself pulls in AsyncStorage at import time. Nothing in
// this file exercises the persisted store, only the pure merge it is
// configured with, so the native module is stubbed rather than installed.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const currentState = {
  timerReminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
  setTimerReminderIntervalMinutes: () => undefined,
  journalReminderEnabled: true,
  journalReminderHour: DEFAULT_JOURNAL_REMINDER_HOUR,
  setJournalReminderEnabled: () => undefined,
  setJournalReminderHour: () => undefined,
  taskDigestEnabled: true,
  taskDigestHours: DEFAULT_TASK_DIGEST_HOURS,
  setTaskDigestEnabled: () => undefined,
  setTaskDigestHours: () => undefined,
};

describe("mergePersistedSettings", () => {
  it("keeps a valid stored reminder interval", () => {
    const merged = mergePersistedSettings({ timerReminderIntervalMinutes: 30 }, currentState);

    expect(merged.timerReminderIntervalMinutes).toBe(30);
  });

  it("drops a retired themePreference key instead of copying it onto state", () => {
    // The upgrade case: storage written by a build where the theme picker
    // still existed. A shallow-spread merge would put `themePreference` back
    // on the live store as a property no type declares and nothing reads.
    const merged = mergePersistedSettings(
      { themePreference: "dark", timerReminderIntervalMinutes: 45 },
      currentState,
    );

    expect(merged).not.toHaveProperty("themePreference");
    expect(merged.timerReminderIntervalMinutes).toBe(45);
  });

  it("hydrates cleanly when the stale key is the only thing in storage", () => {
    // An install that set a theme but never opened the timer's interval
    // picker. The reminder interval has to land on its default, not
    // `undefined` — the scheduler and the picker both read it directly.
    const merged = mergePersistedSettings({ themePreference: "system" }, currentState);

    expect(merged.timerReminderIntervalMinutes).toBe(DEFAULT_REMINDER_INTERVAL_MINUTES);
    expect(merged.setTimerReminderIntervalMinutes).toBe(currentState.setTimerReminderIntervalMinutes);
  });

  it("falls back to the default for absent, malformed, or out-of-range values", () => {
    for (const persisted of [undefined, null, {}, { timerReminderIntervalMinutes: 0 }, { timerReminderIntervalMinutes: "30" }]) {
      expect(mergePersistedSettings(persisted, currentState).timerReminderIntervalMinutes).toBe(
        DEFAULT_REMINDER_INTERVAL_MINUTES,
      );
    }
  });

  it("carries the store's actions through untouched", () => {
    const merged = mergePersistedSettings({ timerReminderIntervalMinutes: 10 }, currentState);

    expect(typeof merged.setTimerReminderIntervalMinutes).toBe("function");
  });

  it("keeps a valid stored journal reminder toggle and hour", () => {
    const merged = mergePersistedSettings(
      { journalReminderEnabled: false, journalReminderHour: 21 },
      currentState,
    );

    expect(merged.journalReminderEnabled).toBe(false);
    expect(merged.journalReminderHour).toBe(21);
  });

  it("defaults journalReminderEnabled to true (not false) for an install that predates it", () => {
    // The upgrade case this feature itself introduces: `undefined` must not
    // read as "explicitly turned off" — that would silently opt an existing
    // user out of a reminder they've never seen a toggle for.
    const merged = mergePersistedSettings({}, currentState);

    expect(merged.journalReminderEnabled).toBe(true);
    expect(merged.journalReminderHour).toBe(DEFAULT_JOURNAL_REMINDER_HOUR);
  });

  it("falls back to the default hour for a malformed or out-of-range value", () => {
    for (const persisted of [{ journalReminderHour: 3 }, { journalReminderHour: "20" }, { journalReminderHour: null }]) {
      expect(mergePersistedSettings(persisted, currentState).journalReminderHour).toBe(
        DEFAULT_JOURNAL_REMINDER_HOUR,
      );
    }
  });

  it("keeps a valid stored task digest toggle and hours", () => {
    const merged = mergePersistedSettings(
      { taskDigestEnabled: false, taskDigestHours: [7, 12, 20] },
      currentState,
    );

    expect(merged.taskDigestEnabled).toBe(false);
    expect(merged.taskDigestHours).toEqual([7, 12, 20]);
  });

  it("defaults taskDigestEnabled to true (not false) for an install that predates it", () => {
    // Same upgrade concern as journalReminderEnabled above, and it matters
    // even more here: this setting replaces the old always-on per-task
    // reminder, so an existing install must keep getting due-today nudges,
    // not silently lose them because `undefined` read as "off".
    const merged = mergePersistedSettings({}, currentState);

    expect(merged.taskDigestEnabled).toBe(true);
    expect(merged.taskDigestHours).toEqual(DEFAULT_TASK_DIGEST_HOURS);
  });

  it("normalizes stored task digest hours: dedupes, sorts, and drops out-of-range values", () => {
    const merged = mergePersistedSettings({ taskDigestHours: [18, 9, 9, -1, 24, 13] }, currentState);

    expect(merged.taskDigestHours).toEqual([9, 13, 18]);
  });

  it("falls back to the default hours for a malformed or empty value", () => {
    for (const persisted of [{ taskDigestHours: [] }, { taskDigestHours: "9" }, { taskDigestHours: null }]) {
      expect(mergePersistedSettings(persisted, currentState).taskDigestHours).toEqual(DEFAULT_TASK_DIGEST_HOURS);
    }
  });
});
