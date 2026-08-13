// No import of `describe`/`it`/`expect`: see derive-online.test.ts's header
// comment — same reason, same exclusion via tsconfig.json.
import { droppedTimeEntryMessage } from "./dropped-time-entry-message";

describe("droppedTimeEntryMessage", () => {
  it("names the duration and the task for a sub-hour entry", () => {
    expect(droppedTimeEntryMessage({ taskName: "Deep work", duration: 45, date: "2026-08-12" })).toBe(
      '45m tracked for "Deep work" couldn\'t be saved.',
    );
  });

  it("formats an hours-and-minutes duration the same way the rest of the app does", () => {
    expect(droppedTimeEntryMessage({ taskName: "Focus session", duration: 90, date: "2026-08-12" })).toBe(
      '1h 30m tracked for "Focus session" couldn\'t be saved.',
    );
  });
});
