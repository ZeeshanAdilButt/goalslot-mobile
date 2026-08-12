import {
  calendarDaysAgo,
  formatConversationTimestamp,
  formatDaySeparator,
  formatMessagePreview,
  formatMessageTime,
  needsDaySeparator,
} from "./format";

// Local-time constructor throughout: every rule here is about the device's
// calendar, so building fixtures from ISO-Z strings would make the tests pass
// or fail depending on the machine's zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (date: Date) => date.toISOString();

const NOW = at(2026, 8, 12, 15, 30); // Wednesday

describe("calendarDaysAgo", () => {
  it("counts midnight boundaries, not elapsed hours", () => {
    // 55 minutes apart, but a day boundary in between.
    expect(calendarDaysAgo(at(2026, 8, 11, 23, 30), at(2026, 8, 12, 0, 25))).toBe(1);
  });

  it("is 0 for any time earlier the same day", () => {
    expect(calendarDaysAgo(at(2026, 8, 12, 0, 1), NOW)).toBe(0);
  });

  it("survives a month boundary", () => {
    expect(calendarDaysAgo(at(2026, 7, 31, 10, 0), at(2026, 8, 1, 10, 0))).toBe(1);
  });
});

describe("formatConversationTimestamp", () => {
  it("shows a clock time today", () => {
    expect(formatConversationTimestamp(iso(at(2026, 8, 12, 9, 5)), NOW)).toBe("9:05 AM");
    expect(formatConversationTimestamp(iso(at(2026, 8, 12, 13, 5)), NOW)).toBe("1:05 PM");
  });

  it("renders midnight and noon as 12, not 0", () => {
    expect(formatConversationTimestamp(iso(at(2026, 8, 12, 0, 0)), NOW)).toBe("12:00 AM");
    expect(formatConversationTimestamp(iso(at(2026, 8, 12, 12, 0)), NOW)).toBe("12:00 PM");
  });

  it("shows Yesterday, then a weekday, then a date", () => {
    expect(formatConversationTimestamp(iso(at(2026, 8, 11, 22, 0)), NOW)).toBe("Yesterday");
    expect(formatConversationTimestamp(iso(at(2026, 8, 9, 10, 0)), NOW)).toBe("Sun");
    expect(formatConversationTimestamp(iso(at(2026, 7, 20, 10, 0)), NOW)).toBe("20 Jul");
  });

  it("includes the year once the message is from a previous one", () => {
    expect(formatConversationTimestamp(iso(at(2025, 12, 20, 10, 0)), NOW)).toBe("20 Dec 2025");
  });

  it("renders nothing rather than 'Invalid Date' for missing or broken input", () => {
    expect(formatConversationTimestamp(undefined, NOW)).toBe("");
    expect(formatConversationTimestamp(null, NOW)).toBe("");
    expect(formatConversationTimestamp("not-a-date", NOW)).toBe("");
  });
});

describe("formatDaySeparator", () => {
  it("uses Today / Yesterday / full weekday inside the last week", () => {
    expect(formatDaySeparator(iso(at(2026, 8, 12, 1, 0)), NOW)).toBe("Today");
    expect(formatDaySeparator(iso(at(2026, 8, 11, 1, 0)), NOW)).toBe("Yesterday");
    expect(formatDaySeparator(iso(at(2026, 8, 9, 1, 0)), NOW)).toBe("Sunday");
  });

  it("falls back to a dated heading beyond a week", () => {
    expect(formatDaySeparator(iso(at(2026, 7, 20, 1, 0)), NOW)).toBe("Monday, 20 Jul");
    expect(formatDaySeparator(iso(at(2025, 7, 20, 1, 0)), NOW)).toBe("20 Jul 2025");
  });
});

describe("needsDaySeparator", () => {
  it("is true for the first message in a thread", () => {
    expect(needsDaySeparator(iso(NOW), undefined)).toBe(true);
  });

  it("is false within the same calendar day and true across midnight", () => {
    expect(needsDaySeparator(iso(at(2026, 8, 12, 23, 59)), iso(at(2026, 8, 12, 0, 1)))).toBe(false);
    expect(needsDaySeparator(iso(at(2026, 8, 12, 0, 1)), iso(at(2026, 8, 11, 23, 59)))).toBe(true);
  });

  it("does not insert a separator when a timestamp is unparseable", () => {
    expect(needsDaySeparator("nope", iso(NOW))).toBe(false);
  });
});

describe("formatMessageTime", () => {
  it("is a clock time, or empty for bad input", () => {
    expect(formatMessageTime(iso(at(2026, 8, 12, 7, 4)))).toBe("7:04 AM");
    expect(formatMessageTime("nope")).toBe("");
  });
});

describe("formatMessagePreview", () => {
  it("collapses newlines so a row does not render a blank second line", () => {
    expect(formatMessagePreview("hello\n\nthere   friend")).toBe("hello there friend");
  });

  it("prefixes the sender when asked", () => {
    expect(formatMessagePreview("hi", "You: ")).toBe("You: hi");
  });

  it("falls back to a placeholder for an empty or missing body", () => {
    expect(formatMessagePreview("")).toBe("No messages yet");
    expect(formatMessagePreview(undefined)).toBe("No messages yet");
    expect(formatMessagePreview("   ")).toBe("No messages yet");
  });
});
