/* eslint-disable @typescript-eslint/no-require-imports -- these tests are
   about *when* a module is loaded, so they must control the require
   themselves: a top-level ESM import would run before jest.mock/
   resetModules could observe it. */
// Startup-cost cover for src/lib/sentry.ts.
//
// `initSentry()` runs at module load in app/_layout.tsx, before the first
// render, and returns immediately because the DSN is still the placeholder.
// It used to `import * as Sentry from "@sentry/react-native"` at the top of
// the file, so every cold start evaluated the whole SDK module graph for a
// guaranteed no-op. (Metro does not tree-shake, so this never shrank the
// bundle — the win is keeping the evaluation off the startup path.)
//
// The mock factory below is the probe: jest only runs it the first time
// something actually requires the module, so `sentryModuleLoaded` staying
// false proves nothing pulled the SDK in.

let sentryModuleLoaded = false;

jest.mock("@sentry/react-native", () => {
  sentryModuleLoaded = true;
  return { init: jest.fn() };
});

describe("initSentry with the placeholder DSN", () => {
  beforeEach(() => {
    sentryModuleLoaded = false;
    jest.resetModules();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not load @sentry/react-native when the module is imported", () => {
    require("./sentry");

    expect(sentryModuleLoaded).toBe(false);
  });

  it("does not load @sentry/react-native when initSentry() is called", () => {
    const { initSentry } = require("./sentry") as typeof import("./sentry");

    initSentry();

    expect(sentryModuleLoaded).toBe(false);
  });

  it("still warns that crash reporting is disabled", () => {
    const { initSentry } = require("./sentry") as typeof import("./sentry");

    initSentry();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Sentry DSN is still the placeholder value")
    );
  });
});
