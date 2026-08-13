// No import of `describe`/`it`/`expect`: same convention as
// timer-reminders.test.ts — Jest injects these as real globals, and this
// file is excluded from `tsc --noEmit` via tsconfig.json's `exclude`.

import { DEFAULT_SESSION_LABEL } from "./session-label";

describe("DEFAULT_SESSION_LABEL", () => {
  it("matches dw-time-web and dw-time-api's wording for the same concept", () => {
    expect(DEFAULT_SESSION_LABEL).toBe("Untitled session");
  });

  // Regression guard for the actual bug: mobile used to say "Focus session"
  // here, which split one real-world bucket into two in any report that
  // groups by task name across platforms.
  it("is not the old, platform-inconsistent wording", () => {
    expect(DEFAULT_SESSION_LABEL).not.toBe("Focus session");
  });
});
