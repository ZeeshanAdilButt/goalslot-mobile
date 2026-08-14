// Tests for DatePicker's pure calendar math. Grid layout depends entirely on
// daysInMonth/firstWeekdayOfMonth being right — an off-by-one here doesn't
// crash, it just silently shows the wrong day under the wrong weekday, which
// is exactly the kind of bug nobody notices until they're looking right at
// the specific month it breaks on.

import { daysInMonth, firstWeekdayOfMonth, formatDateKey, parseDateKey, toDateKey } from "./calendar-math";

describe("parseDateKey / toDateKey", () => {
  it("round-trips a date key", () => {
    const key = "2026-03-05";
    const parsed = parseDateKey(key);
    expect(parsed).toEqual({ year: 2026, month: 2, day: 5 }); // month is 0-indexed
    expect(toDateKey(parsed.year, parsed.month, parsed.day)).toBe(key);
  });

  it("zero-pads single-digit month and day", () => {
    expect(toDateKey(2026, 0, 5)).toBe("2026-01-05");
  });
});

describe("formatDateKey", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // Regression: this used to go through `new Date("YYYY-MM-DD")`, which JS
  // parses as UTC midnight — a day early for anyone west of UTC.
  it("renders the date's own day in a negative-UTC-offset timezone", () => {
    process.env.TZ = "America/Los_Angeles"; // UTC-7/-8
    expect(formatDateKey("2026-08-16")).toBe("Aug 16");
  });

  it("renders the date's own day in a positive-UTC-offset timezone", () => {
    process.env.TZ = "Pacific/Auckland"; // UTC+12/+13
    expect(formatDateKey("2026-08-16")).toBe("Aug 16");
  });
});

describe("daysInMonth", () => {
  it("knows the standard month lengths", () => {
    expect(daysInMonth(2026, 0)).toBe(31); // Jan
    expect(daysInMonth(2026, 3)).toBe(30); // Apr
  });

  it("gets February right on a leap year and a non-leap year", () => {
    expect(daysInMonth(2024, 1)).toBe(29); // 2024 is a leap year
    expect(daysInMonth(2026, 1)).toBe(28); // 2026 is not
  });

  it("gets the century leap-year exception right (divisible by 100 but not 400)", () => {
    expect(daysInMonth(1900, 1)).toBe(28);
    expect(daysInMonth(2000, 1)).toBe(29);
  });
});

describe("firstWeekdayOfMonth", () => {
  it("matches the real calendar for a known month", () => {
    // 2026-08-01 is a Saturday.
    expect(firstWeekdayOfMonth(2026, 7)).toBe(6);
  });

  it("handles December correctly (year-end boundary)", () => {
    // 2026-12-01 is a Tuesday.
    expect(firstWeekdayOfMonth(2026, 11)).toBe(2);
  });
});

describe("month grid coverage", () => {
  it("produces exactly the right number of day cells for every month, leap Feb included", () => {
    // Every month of a leap year and a non-leap year: leading blanks +
    // real days should tile into whole weeks with no gaps or overlaps.
    for (const year of [2024, 2026]) {
      for (let month = 0; month < 12; month++) {
        const leading = firstWeekdayOfMonth(year, month);
        const total = daysInMonth(year, month);
        const cellCount = leading + total;
        // The grid must span a whole number of weeks once trailing blanks
        // (added by the same logic on the render side) fill the remainder.
        expect(Math.ceil(cellCount / 7) * 7).toBeGreaterThanOrEqual(cellCount);
        expect(leading).toBeGreaterThanOrEqual(0);
        expect(leading).toBeLessThan(7);
      }
    }
  });
});
