// The regression these lock down: the API returns `deadline` as a full ISO
// instant (Prisma DateTime), and both Goals call sites used to mis-read it —
// one printed "Invalid Date", the other printed the previous calendar day for
// anyone behind UTC. See deadline.ts's header for the full trace.
//
// Formatting assertions stay locale-agnostic on purpose: `toLocaleDateString`
// output depends on the ICU data in whatever environment jest runs in, so
// these check the facts that must hold (the day number is present, the year
// appears only when it should, nothing renders as "Invalid Date") rather than
// pinning an en-US string.

import {
  deadlineUrgency,
  describeDeadline,
  formatDeadlineDay,
  formatDeadlineLong,
  toDeadlineKey,
} from "./deadline";

describe("toDeadlineKey", () => {
  it("takes the calendar day off a full ISO instant, the way web's goal-modal does", () => {
    expect(toDeadlineKey("2026-03-04T00:00:00.000Z")).toBe("2026-03-04");
  });

  it("passes a bare date key straight through", () => {
    expect(toDeadlineKey("2026-03-04")).toBe("2026-03-04");
  });

  it("does not shift the day for a UTC-midnight instant, whatever the local zone", () => {
    // The bug this replaces: `new Date("2026-01-01T00:00:00.000Z").getDate()`
    // is Dec 31 anywhere behind UTC.
    expect(toDeadlineKey("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
  });

  it("treats missing values as no deadline", () => {
    expect(toDeadlineKey(undefined)).toBeNull();
    expect(toDeadlineKey(null)).toBeNull();
    expect(toDeadlineKey("")).toBeNull();
    expect(toDeadlineKey("   ")).toBeNull();
  });

  it("rejects anything that isn't a real calendar day instead of rendering Invalid Date", () => {
    expect(toDeadlineKey("not-a-date")).toBeNull();
    expect(toDeadlineKey("2026-13-01")).toBeNull();
    expect(toDeadlineKey("2026-02-30")).toBeNull();
    expect(toDeadlineKey("2026-00-10")).toBeNull();
    expect(toDeadlineKey("2026-01-00")).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(toDeadlineKey("2028-02-29")).toBe("2028-02-29");
    expect(toDeadlineKey("2027-02-29")).toBeNull();
  });
});

describe("deadlineUrgency", () => {
  const today = "2026-08-11";

  it("classifies past, present and future", () => {
    expect(deadlineUrgency("2026-08-10", today)).toBe("overdue");
    expect(deadlineUrgency("2026-08-11", today)).toBe("today");
    expect(deadlineUrgency("2026-08-12", today)).toBe("soon");
  });

  it("treats the next seven days as soon and the eighth as later", () => {
    expect(deadlineUrgency("2026-08-18", today)).toBe("soon");
    expect(deadlineUrgency("2026-08-19", today)).toBe("later");
  });

  it("compares across a year boundary", () => {
    expect(deadlineUrgency("2025-12-31", today)).toBe("overdue");
    expect(deadlineUrgency("2027-01-01", today)).toBe("later");
  });
});

describe("describeDeadline", () => {
  const today = "2026-08-11";

  it("names the near dates instead of printing them", () => {
    expect(describeDeadline("2026-08-11", today)).toBe("Due today");
    expect(describeDeadline("2026-08-12", today)).toBe("Due tomorrow");
  });

  it("marks an overdue deadline as overdue", () => {
    expect(describeDeadline("2026-08-01", today)).toMatch(/^Overdue · /);
  });

  it("falls back to a plain due date further out", () => {
    const label = describeDeadline("2026-09-30", today);
    expect(label).toMatch(/^Due /);
    expect(label).toContain("30");
  });

  it("never leaks an invalid date into the chip", () => {
    for (const key of ["2026-08-11", "2026-08-12", "2026-08-01", "2027-03-04"]) {
      expect(describeDeadline(key, today)).not.toContain("Invalid");
    }
  });
});

describe("formatDeadlineDay", () => {
  it("drops the year within the current year and keeps it outside", () => {
    expect(formatDeadlineDay("2026-03-04", "2026-08-11")).not.toContain("2026");
    expect(formatDeadlineDay("2028-03-04", "2026-08-11")).toContain("2028");
  });

  it("renders the requested day, not the one before it", () => {
    expect(formatDeadlineDay("2026-03-04", "2026-08-11")).toContain("4");
    expect(formatDeadlineDay("2026-03-04", "2026-08-11")).not.toContain("3,");
  });
});

describe("formatDeadlineLong", () => {
  it("always carries the year, matching web's MMM d, yyyy", () => {
    const label = formatDeadlineLong("2026-03-04");
    expect(label).toContain("2026");
    expect(label).toContain("4");
    expect(label).not.toContain("Invalid");
  });
});
