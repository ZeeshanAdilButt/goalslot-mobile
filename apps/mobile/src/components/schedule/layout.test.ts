// Tests for the Schedule time-axis geometry.
//
// This module is pure and load-bearing: every block's on-screen position and
// width comes from it, and a regression here is silent — blocks still render,
// they just render in the wrong place or on top of each other. That is exactly
// the class of bug a screenshot review misses, so it is pinned down here.

import type { ScheduleBlock } from "@goalslot/shared";

import {
  HOUR_HEIGHT,
  MIN_BLOCK_HEIGHT,
  PX_PER_MIN,
  blockDensity,
  blockStatus,
  getDayWindow,
  isWithinWindow,
  minuteToY,
  positionBlocks,
  windowHeight,
  withAlpha,
} from "./layout";

// Only the four fields the geometry actually reads are meaningful; the rest
// exist to satisfy the type without implying the layout depends on them.
function block(id: string, startTime: string, endTime: string): ScheduleBlock {
  return {
    id,
    title: id,
    startTime,
    endTime,
    dayOfWeek: 1,
    category: "work",
    color: "#F2CC0D",
    isRecurring: false,
    isPrivate: false,
    seriesId: "",
  } as ScheduleBlock;
}

describe("getDayWindow", () => {
  // Always the full day now — see layout.ts's header for why a trimmed
  // window was tried and reverted (users want to see all 24 hours, and
  // auto-scroll-to-now already lands on the relevant time without it).
  it("is the full day for an empty day", () => {
    expect(getDayWindow([])).toEqual({ startHour: 0, endHour: 24 });
  });

  it("is the full day regardless of where the content falls", () => {
    expect(getDayWindow([block("a", "09:00", "10:00")])).toEqual({ startHour: 0, endHour: 24 });
  });

  it("is the full day for content near midnight on either end", () => {
    expect(getDayWindow([block("a", "00:15", "01:00")])).toEqual({ startHour: 0, endHour: 24 });
    expect(getDayWindow([block("a", "22:00", "23:59")])).toEqual({ startHour: 0, endHour: 24 });
  });

  it("is the full day for a short block", () => {
    expect(getDayWindow([block("a", "09:00", "09:15")])).toEqual({ startHour: 0, endHour: 24 });
  });

  it("is the full day across many blocks", () => {
    expect(
      getDayWindow([
        block("late", "16:00", "17:00"),
        block("early", "09:00", "10:00"),
        block("mid", "12:00", "13:00"),
      ]),
    ).toEqual({ startHour: 0, endHour: 24 });
  });
});

describe("minuteToY / windowHeight", () => {
  const window = { startHour: 8, endHour: 11 };

  it("places the window's first minute at the very top", () => {
    expect(minuteToY(8 * 60, window)).toBe(0);
  });

  it("scales offsets by the pixels-per-minute constant", () => {
    expect(minuteToY(9 * 60, window)).toBeCloseTo(60 * PX_PER_MIN);
  });

  it("derives total height from the number of hours shown", () => {
    expect(windowHeight(window)).toBeCloseTo(3 * HOUR_HEIGHT);
  });

  it("treats both window edges as inside, and anything beyond as outside", () => {
    expect(isWithinWindow(8 * 60, window)).toBe(true);
    expect(isWithinWindow(11 * 60, window)).toBe(true);
    expect(isWithinWindow(8 * 60 - 1, window)).toBe(false);
    expect(isWithinWindow(11 * 60 + 1, window)).toBe(false);
  });
});

describe("positionBlocks", () => {
  it("returns every block, ordered by start time", () => {
    const result = positionBlocks([
      block("second", "10:00", "11:00"),
      block("first", "09:00", "10:00"),
    ]);
    expect(result.map((entry) => entry.block.id)).toEqual(["first", "second"]);
  });

  it("gives a lone block the full width", () => {
    const [only] = positionBlocks([block("a", "09:00", "10:00")]);
    expect(only).toMatchObject({ column: 0, columnCount: 1 });
  });

  it("keeps back-to-back blocks full width — touching is not overlapping", () => {
    // 10:00 end / 10:00 start must NOT be treated as a collision, otherwise a
    // normal consecutive schedule would render every block at half width.
    const result = positionBlocks([block("a", "09:00", "10:00"), block("b", "10:00", "11:00")]);
    expect(result.every((entry) => entry.columnCount === 1)).toBe(true);
  });

  it("splits two genuinely overlapping blocks into side-by-side lanes", () => {
    const result = positionBlocks([block("a", "09:00", "10:00"), block("b", "09:30", "10:30")]);
    expect(result.map((entry) => entry.column)).toEqual([0, 1]);
    expect(result.every((entry) => entry.columnCount === 2)).toBe(true);
  });

  it("reuses a lane once it is free, and widths stay uniform across the cluster", () => {
    // a 09:00-10:00, b 09:30-10:30, c 10:00-11:00 — c may reuse a's lane
    // because a has ended, but the cluster is still two lanes wide.
    const result = positionBlocks([
      block("a", "09:00", "10:00"),
      block("b", "09:30", "10:30"),
      block("c", "10:00", "11:00"),
    ]);
    const byId = Object.fromEntries(result.map((entry) => [entry.block.id, entry]));
    expect(byId.a.column).toBe(0);
    expect(byId.b.column).toBe(1);
    expect(byId.c.column).toBe(0);
    expect(result.every((entry) => entry.columnCount === 2)).toBe(true);
  });

  it("keeps separate clusters independent, so one overlap cannot narrow the whole day", () => {
    const result = positionBlocks([
      block("a", "09:00", "10:00"),
      block("b", "09:30", "10:30"),
      block("far", "15:00", "16:00"),
    ]);
    const byId = Object.fromEntries(result.map((entry) => [entry.block.id, entry]));
    expect(byId.far.columnCount).toBe(1);
    expect(byId.a.columnCount).toBe(2);
  });

  it("gives a block fully contained inside another its own lane", () => {
    const result = positionBlocks([block("outer", "09:00", "12:00"), block("inner", "10:00", "11:00")]);
    expect(result.map((entry) => entry.column)).toEqual([0, 1]);
  });

  it("handles an empty day", () => {
    expect(positionBlocks([])).toEqual([]);
  });

  it("exposes start and end in minutes-of-day", () => {
    const [only] = positionBlocks([block("a", "09:30", "10:45")]);
    expect(only.startMin).toBe(570);
    expect(only.endMin).toBe(645);
  });
});

describe("withAlpha", () => {
  it("appends the alpha suffix to a valid hex colour", () => {
    expect(withAlpha("#F2CC0D", "1A")).toBe("#F2CC0D1A");
  });

  it("returns null for malformed or missing colours so the caller can fall back", () => {
    // A stored colour that isn't 6-digit hex must not produce an invalid style
    // value — callers rely on null to substitute a theme token.
    expect(withAlpha(undefined, "1A")).toBeNull();
    expect(withAlpha("", "1A")).toBeNull();
    expect(withAlpha("red", "1A")).toBeNull();
    expect(withAlpha("#FFF", "1A")).toBeNull();
  });
});

describe("blockStatus", () => {
  const entry = { startMin: 540, endMin: 600 }; // 09:00-10:00

  it("treats an unknown clock as upcoming rather than guessing", () => {
    expect(blockStatus(entry, null)).toBe("upcoming");
  });

  it("classifies before, during and after", () => {
    expect(blockStatus(entry, 500)).toBe("upcoming");
    expect(blockStatus(entry, 570)).toBe("active");
    expect(blockStatus(entry, 700)).toBe("past");
  });

  it("is active exactly at its start minute", () => {
    expect(blockStatus(entry, 540)).toBe("active");
  });
});

describe("blockDensity", () => {
  it("degrades gracefully as the rendered height shrinks", () => {
    const tall = blockDensity(200);
    const short = blockDensity(MIN_BLOCK_HEIGHT);
    expect(tall).not.toBe(short);
  });
});
