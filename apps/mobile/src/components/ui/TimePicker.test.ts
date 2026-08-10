// Tests for TimePicker's pure "HH:mm" <-> wheel-index conversion. This is
// the load-bearing logic for the whole component: the wheel UI can only ever
// be as correct as parseValue/toTimeString are, and a rounding bug here is
// silent — the wheel still scrolls, it just lands on the wrong hour.

import { parseValue, toTimeString } from "./TimePicker";

describe("parseValue", () => {
  it("splits a 24h time into 12h hour, 5-minute index, and meridiem", () => {
    expect(parseValue("09:15")).toEqual({ hour12: 9, minuteIndex: 3, meridiem: "AM" });
    expect(parseValue("14:30")).toEqual({ hour12: 2, minuteIndex: 6, meridiem: "PM" });
  });

  it("maps midnight to 12 AM and noon to 12 PM", () => {
    expect(parseValue("00:00")).toEqual({ hour12: 12, minuteIndex: 0, meridiem: "AM" });
    expect(parseValue("12:00")).toEqual({ hour12: 12, minuteIndex: 0, meridiem: "PM" });
  });

  it("rounds a non-5-multiple minute to the nearest wheel stop", () => {
    expect(parseValue("09:37")).toEqual({ hour12: 9, minuteIndex: 7, meridiem: "AM" }); // -> :35
    expect(parseValue("09:38")).toEqual({ hour12: 9, minuteIndex: 8, meridiem: "AM" }); // -> :40
  });

  it("rolls into the next hour when minutes round up to :60, rather than wrapping to :00 of the same hour", () => {
    // 58 is much closer to the NEXT hour's :00 than to THIS hour's :00 — a
    // naive `% 12` on the rounded step wraps back to :00 and silently
    // reports the wrong hour by nearly sixty minutes.
    expect(parseValue("09:58")).toEqual({ hour12: 10, minuteIndex: 0, meridiem: "AM" });
  });

  it("carries the hour-rollover across the AM/PM boundary", () => {
    expect(parseValue("11:58")).toEqual({ hour12: 12, minuteIndex: 0, meridiem: "PM" });
  });

  it("carries the hour-rollover across midnight", () => {
    expect(parseValue("23:58")).toEqual({ hour12: 12, minuteIndex: 0, meridiem: "AM" });
  });
});

describe("toTimeString", () => {
  it("is the exact inverse of parseValue for every 5-minute stop across a full day", () => {
    for (let h = 0; h < 24; h++) {
      for (let step = 0; step < 12; step++) {
        const minutes = step * 5;
        const input = `${h.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
        const parsed = parseValue(input);
        expect(toTimeString(parsed.hour12, parsed.minuteIndex, parsed.meridiem)).toBe(input);
      }
    }
  });

  it("maps 12 AM back to 00:00 and 12 PM back to 12:00", () => {
    expect(toTimeString(12, 0, "AM")).toBe("00:00");
    expect(toTimeString(12, 0, "PM")).toBe("12:00");
  });
});
