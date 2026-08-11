import { describeCountdown, isSameCalendarDay } from "./countdown";

// Local-time constructor throughout: `describeCountdown` answers a calendar
// question in the device's own zone, so building the fixtures any other way
// would test the wrong thing.
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min, 0, 0);

describe("isSameCalendarDay", () => {
  it("matches two instants on the same local date", () => {
    expect(isSameCalendarDay(at(2026, 8, 11, 0, 1), at(2026, 8, 11, 23, 59))).toBe(true);
  });

  it("separates instants one minute apart across midnight", () => {
    expect(isSameCalendarDay(at(2026, 8, 11, 23, 59), at(2026, 8, 12, 0, 0))).toBe(false);
  });

  it("does not confuse the same day-of-month in different months or years", () => {
    expect(isSameCalendarDay(at(2026, 8, 11, 9, 0), at(2026, 9, 11, 9, 0))).toBe(false);
    expect(isSameCalendarDay(at(2026, 8, 11, 9, 0), at(2027, 8, 11, 9, 0))).toBe(false);
  });
});

describe("describeCountdown", () => {
  it("says 'starting now' at the start instant", () => {
    const now = at(2026, 8, 11, 9, 0);
    expect(describeCountdown(now, now)).toBe("starting now");
  });

  it("says 'starting now' for a start that has already slipped past", () => {
    expect(describeCountdown(at(2026, 8, 11, 9, 5), at(2026, 8, 11, 9, 0))).toBe("starting now");
  });

  it("counts down in minutes within the hour", () => {
    expect(describeCountdown(at(2026, 8, 11, 9, 0), at(2026, 8, 11, 9, 25))).toBe("in 25m");
  });

  it("counts down in hours and minutes later the same day", () => {
    expect(describeCountdown(at(2026, 8, 11, 9, 0), at(2026, 8, 11, 12, 30))).toBe("in 3h 30m");
  });

  it("drops the minutes on a whole-hour gap", () => {
    expect(describeCountdown(at(2026, 8, 11, 9, 0), at(2026, 8, 11, 11, 0))).toBe("in 2h");
  });

  // The regression this module exists for: the previous implementation
  // returned a raw duration for every upcoming block, so an evening with
  // nothing left today rendered tomorrow's 9am block as "in 13h 20m".
  it("says 'tomorrow' rather than a long duration for the next day", () => {
    expect(describeCountdown(at(2026, 8, 11, 19, 40), at(2026, 8, 12, 9, 0))).toBe("tomorrow");
  });

  it("says 'tomorrow' even when the start is only minutes away across midnight", () => {
    expect(describeCountdown(at(2026, 8, 11, 23, 50), at(2026, 8, 12, 0, 5))).toBe("tomorrow");
  });

  it("names the weekday for anything beyond tomorrow", () => {
    // 2026-08-14 is a Friday.
    expect(describeCountdown(at(2026, 8, 11, 9, 0), at(2026, 8, 14, 9, 0))).toBe("Fri");
  });

  it("names the weekday at the far end of the seven-day search window", () => {
    // 2026-08-17 is the following Monday.
    expect(describeCountdown(at(2026, 8, 11, 9, 0), at(2026, 8, 17, 9, 0))).toBe("Mon");
  });

  it("rolls 'tomorrow' across a month boundary", () => {
    expect(describeCountdown(at(2026, 8, 31, 22, 0), at(2026, 9, 1, 8, 0))).toBe("tomorrow");
  });

  it("rolls 'tomorrow' across a year boundary", () => {
    expect(describeCountdown(at(2026, 12, 31, 22, 0), at(2027, 1, 1, 8, 0))).toBe("tomorrow");
  });
});
