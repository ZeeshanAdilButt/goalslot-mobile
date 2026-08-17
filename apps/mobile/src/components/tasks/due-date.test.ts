// The regression these lock down: the API returns `dueDate` as a full ISO
// instant (Prisma DateTime, no serializer), and TaskMetaChips used to hand it
// straight to a "YYYY-MM-DD" parser — producing NaN parts and rendering the
// literal text "Invalid Date" in the chip (uppercased to "DUE INVALID DATE").
// See due-date.ts's header for the full trace.
//
// These must go through `formatDueDate`, the function the chip actually
// calls. A test on `toDateKeyFromApi` alone would have passed on the broken
// code, because the broken code never called it.
//
// Day-number assertions are written locale-agnostically where the month name
// isn't the point (same reasoning as goals/deadline.test.ts's header), but the
// "Aug 20" pins are safe: ui/DatePicker.test.ts already pins "Aug 16" through
// the same `formatDateKey`, so en-US ICU data is present in this environment.

import { formatDueDate, toDueDateKey } from "./due-date";

describe("toDueDateKey", () => {
  it("takes the calendar day off the full ISO instant the API actually returns", () => {
    expect(toDueDateKey("2026-08-20T00:00:00.000Z")).toBe("2026-08-20");
  });

  it("passes a bare date key straight through", () => {
    expect(toDueDateKey("2026-08-20")).toBe("2026-08-20");
  });

  it("treats missing or blank values as no due date", () => {
    expect(toDueDateKey(undefined)).toBeNull();
    expect(toDueDateKey(null)).toBeNull();
    expect(toDueDateKey("")).toBeNull();
    expect(toDueDateKey("   ")).toBeNull();
  });

  it("rejects unparseable and impossible values rather than inventing a day", () => {
    expect(toDueDateKey("today")).toBeNull();
    expect(toDueDateKey("ASAP")).toBeNull();
    expect(toDueDateKey("not-a-date")).toBeNull();
    expect(toDueDateKey("08/20/2026")).toBeNull();
    expect(toDueDateKey("2026-13-40")).toBeNull();
    expect(toDueDateKey("2026-02-30")).toBeNull();
  });
});

describe("formatDueDate", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // The exact reported bug: two Coach-created tasks whose chips read
  // "DUE INVALID DATE" on the Tasks screen.
  it("formats a full ISO instant, the shape the API actually returns", () => {
    expect(formatDueDate("2026-08-20T00:00:00.000Z")).toBe("Aug 20");
  });

  it("never renders the literal string 'Invalid Date' for any instant shape", () => {
    for (const value of [
      "2026-08-20T00:00:00.000Z",
      "2026-08-20T14:30:00Z",
      "2026-08-20T00:00:00+00:00",
      "2026-08-20T00:00:00.000+05:00",
    ]) {
      expect(formatDueDate(value)).not.toMatch(/Invalid/);
    }
  });

  it("still handles a bare date key, the shape the DatePicker produces", () => {
    expect(formatDueDate("2026-08-20")).toBe("Aug 20");
  });

  it("degrades to null rather than a broken chip", () => {
    for (const value of [undefined, null, "", "   ", "today", "2026-13-40"]) {
      expect(formatDueDate(value)).toBeNull();
    }
  });

  // The trap `getLocalDateString` warns about: `new Date(instant)` read in
  // local time is the PREVIOUS day for anyone behind UTC.
  it("does not shift the day for a UTC-midnight instant in a negative-offset zone", () => {
    process.env.TZ = "America/Los_Angeles"; // UTC-7/-8
    expect(toDueDateKey("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
    expect(formatDueDate("2026-01-01T00:00:00.000Z")).toBe("Jan 1");
  });

  it("does not shift the day for a UTC-midnight instant in a positive-offset zone", () => {
    process.env.TZ = "Pacific/Auckland"; // UTC+12/+13
    expect(formatDueDate("2026-01-01T00:00:00.000Z")).toBe("Jan 1");
  });
});
