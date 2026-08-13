// No import of `describe`/`it`/`expect`: same convention as
// timer-reminders.test.ts — Jest injects these as real globals, and this
// file is excluded from `tsc --noEmit` via tsconfig.json's `exclude`.

import { hasReachedDailyEntryCap, isPlanLimitError } from "./plan-limit";

describe("isPlanLimitError", () => {
  it("is true for a 403 response", () => {
    expect(isPlanLimitError({ response: { status: 403 } })).toBe(true);
  });

  it.each([401, 400, 404, 429, 500])("is false for a %d response", (status) => {
    expect(isPlanLimitError({ response: { status } })).toBe(false);
  });

  it("is false for an offline/network error with no response at all", () => {
    expect(isPlanLimitError(new Error("Network Error"))).toBe(false);
  });

  it.each([null, undefined, "nope", 403, {}])("is false for non-error input %p", (value) => {
    expect(isPlanLimitError(value)).toBe(false);
  });
});

describe("hasReachedDailyEntryCap", () => {
  it("is false while under the cap", () => {
    expect(hasReachedDailyEntryCap(2, 3)).toBe(false);
  });

  it("is true exactly at the cap", () => {
    expect(hasReachedDailyEntryCap(3, 3)).toBe(true);
  });

  it("is true past the cap", () => {
    expect(hasReachedDailyEntryCap(4, 3)).toBe(true);
  });

  it("is false at zero entries against a zero-ish edge case still under a real cap", () => {
    expect(hasReachedDailyEntryCap(0, 3)).toBe(false);
  });

  // JSON.stringify(Infinity) is `null` — see the function's own doc comment
  // and settings.tsx's formatLimit for the same rule applied to display text.
  it.each([null, undefined, Infinity, NaN])(
    "treats a non-finite limit (%p) as no cap, never a cap of zero",
    (limit) => {
      expect(hasReachedDailyEntryCap(1000, limit)).toBe(false);
    },
  );
});
