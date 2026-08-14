// Cover for the session history's grouping maths and its destructive copy.
//
// The grouping cases that matter are the ones a naive implementation gets
// wrong: days must come back newest-first (not insertion order), the per-day
// total must sum only that day's entries, and the Today/Yesterday headings
// must be derived in LOCAL time — a `toISOString()`-based day key shows the
// previous day for anyone behind UTC, which is the exact bug
// getLocalDateString exists to prevent.
//
// The delete copy is tested because it is the last thing a user reads before
// losing measured time: it has to name the duration, and it has to warn that
// an attributed entry drags its goal's logged total down with it.

import {
  buildSessionItems,
  describeSessionDelete,
  describeSessionEntry,
  removeSessionEntry,
  sessionEntryTitle,
} from "./session-entries";

import type { TimeEntry } from "@goalslot/shared";

function entry(id: string, date: string, duration: number, extra: Partial<TimeEntry> = {}): TimeEntry {
  return { id, taskName: "Untitled session", date, duration, ...extra };
}

/** Local-midnight Date, so the helpers below never cross a UTC day boundary. */
function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

describe("buildSessionItems", () => {
  const now = localDate(2026, 8, 14);

  it("groups entries under one header per day, newest day first", () => {
    const items = buildSessionItems(
      [entry("a", "2026-08-12", 30), entry("b", "2026-08-14", 15), entry("c", "2026-08-12", 45)],
      now,
    );

    expect(items.map((item) => item.kind)).toEqual(["header", "entry", "header", "entry", "entry"]);
    expect(items[0]).toMatchObject({ kind: "header", label: "Today" });
    expect(items[1]).toMatchObject({ kind: "entry", key: "b" });
    expect(items[2]).toMatchObject({ kind: "header" });
    expect(items.slice(3).map((item) => item.key)).toEqual(["a", "c"]);
  });

  it("totals each day independently", () => {
    const items = buildSessionItems([entry("a", "2026-08-12", 30), entry("b", "2026-08-12", 45), entry("c", "2026-08-14", 15)], now);
    const headers = items.filter((item) => item.kind === "header");

    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({ label: "Today", minutes: 15 });
    expect(headers[1]).toMatchObject({ minutes: 75 });
  });

  it("labels today and yesterday by name and everything older by date", () => {
    const items = buildSessionItems(
      [entry("a", "2026-08-14", 5), entry("b", "2026-08-13", 5), entry("c", "2026-08-10", 5)],
      now,
    );
    const labels = items.filter((item) => item.kind === "header").map((item) => item.label);

    expect(labels[0]).toBe("Today");
    expect(labels[1]).toBe("Yesterday");
    // Not "Today"/"Yesterday", and not the day before or after — the heading
    // is built from the date parts rather than `new Date("2026-08-10")`,
    // which would be parsed as UTC midnight and shift for anyone behind UTC.
    expect(labels[2]).not.toMatch(/Today|Yesterday/);
    expect(labels[2]).toContain("10");
  });

  it("tolerates a full ISO timestamp in `date`", () => {
    const items = buildSessionItems([entry("a", "2026-08-14T09:30:00.000Z", 20)], now);
    expect(items[0]).toMatchObject({ kind: "header", label: "Today", minutes: 20 });
  });

  it("returns nothing for an empty list", () => {
    expect(buildSessionItems([], now)).toEqual([]);
  });
});

describe("sessionEntryTitle", () => {
  it("prefers a real task's denormalised title", () => {
    expect(sessionEntryTitle(entry("a", "2026-08-14", 30, { taskTitle: "Write the brief" }))).toBe("Write the brief");
  });

  it("falls back to the entry's own name", () => {
    expect(sessionEntryTitle(entry("a", "2026-08-14", 30))).toBe("Untitled session");
  });

  it("ignores an empty taskTitle rather than rendering a blank row", () => {
    expect(sessionEntryTitle(entry("a", "2026-08-14", 30, { taskTitle: "" }))).toBe("Untitled session");
  });
});

describe("describeSessionEntry", () => {
  it("names the goal when the entry has one", () => {
    const described = describeSessionEntry(
      entry("a", "2026-08-14", 90, { goal: { id: "g1", title: "Ship the app", color: "#000" } as TimeEntry["goal"] }),
    );
    expect(described).toBe("Untitled session, 1h 30m, Ship the app");
  });

  it("says so out loud when the entry is unattributed", () => {
    expect(describeSessionEntry(entry("a", "2026-08-14", 1))).toBe("Untitled session, 1m, no goal");
  });
});

describe("describeSessionDelete", () => {
  it("warns that an attributed entry moves its goal's logged total", () => {
    const { title, description } = describeSessionDelete(
      entry("a", "2026-08-14", 45, { goal: { id: "g1", title: "Deen", color: "#000" } as TimeEntry["goal"] }),
    );
    expect(title).toBe("Delete this session?");
    expect(description).toContain("45m");
    expect(description).toContain('"Deen"');
    expect(description).toContain("logged time goes down");
    expect(description).toContain("can't be undone");
  });

  it("names the session instead when there is no goal to warn about", () => {
    const { description } = describeSessionDelete(entry("a", "2026-08-14", 1));
    expect(description).toContain("1m");
    expect(description).toContain('"Untitled session"');
    expect(description).not.toContain("logged time goes down");
  });
});

describe("removeSessionEntry", () => {
  const entries = [entry("a", "2026-08-14", 5), entry("b", "2026-08-14", 5)];

  it("drops only the targeted entry", () => {
    expect(removeSessionEntry(entries, "a").map((e) => e.id)).toEqual(["b"]);
  });

  it("leaves the list alone (and does not mutate it) when the id is unknown", () => {
    expect(removeSessionEntry(entries, "nope").map((e) => e.id)).toEqual(["a", "b"]);
    expect(entries).toHaveLength(2);
  });
});
