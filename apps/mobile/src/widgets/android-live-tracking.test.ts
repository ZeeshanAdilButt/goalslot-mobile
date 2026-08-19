import { buildLiveTrackingPayload } from "./android-live-tracking";

describe("buildLiveTrackingPayload", () => {
  it("passes through a well-formed input unchanged", () => {
    expect(
      buildLiveTrackingPayload({
        primaryLabel: "Deep work",
        secondaryLabel: "Ship the launch",
        startedAtMs: 1_000,
        pausedElapsedMs: 60_000,
      }),
    ).toEqual({
      taskName: "Deep work",
      secondaryLabel: "Ship the launch",
      startedAtMs: 1_000,
      pausedElapsedMs: 60_000,
    });
  });

  it.each([null, undefined, "", "   "])("falls back to a placeholder task name for %p", (primaryLabel) => {
    expect(buildLiveTrackingPayload({ primaryLabel, startedAtMs: 0, pausedElapsedMs: 0 }).taskName).toBe(
      "Untitled session",
    );
  });

  it("trims a primary label rather than shipping surrounding whitespace to the widget", () => {
    expect(
      buildLiveTrackingPayload({ primaryLabel: "  Focus block  ", startedAtMs: 0, pausedElapsedMs: 0 }).taskName,
    ).toBe("Focus block");
  });

  it.each([undefined, null, "", "   "])("omits secondaryLabel entirely for %p, not just as null", (secondaryLabel) => {
    const payload = buildLiveTrackingPayload({
      primaryLabel: "Focus block",
      secondaryLabel,
      startedAtMs: 0,
      pausedElapsedMs: 0,
    });
    expect(payload.secondaryLabel).toBeUndefined();
    expect("secondaryLabel" in payload).toBe(true);
  });

  it("trims a secondary label", () => {
    expect(
      buildLiveTrackingPayload({
        primaryLabel: "Focus block",
        secondaryLabel: "  Ship the launch  ",
        startedAtMs: 0,
        pausedElapsedMs: 0,
      }).secondaryLabel,
    ).toBe("Ship the launch");
  });

  it("substitutes Date.now() for a non-finite startedAtMs rather than shipping NaN to native code", () => {
    const before = Date.now();
    const payload = buildLiveTrackingPayload({ primaryLabel: "x", startedAtMs: NaN, pausedElapsedMs: 0 });
    const after = Date.now();
    expect(payload.startedAtMs).toBeGreaterThanOrEqual(before);
    expect(payload.startedAtMs).toBeLessThanOrEqual(after);
  });

  it.each([NaN, Infinity, -Infinity])(
    "clamps a non-finite pausedElapsedMs (%p) to 0, same guard as timer-store.ts's getElapsedMs",
    (pausedElapsedMs) => {
      expect(buildLiveTrackingPayload({ primaryLabel: "x", startedAtMs: 0, pausedElapsedMs }).pausedElapsedMs).toBe(
        0,
      );
    },
  );

  it("clamps a negative pausedElapsedMs to 0", () => {
    expect(buildLiveTrackingPayload({ primaryLabel: "x", startedAtMs: 0, pausedElapsedMs: -500 }).pausedElapsedMs).toBe(
      0,
    );
  });
});
