import {
  defaultSlotEndTime,
  defaultSlotRange,
  defaultSlotStartTime,
  timeToMinutes,
} from "./quick-add-slot-times";

/**
 * Regression cover for the recurring "duplicate schedule blocks" report.
 *
 * Quick-add's time helpers wrapped with `% (24 * 60)`, so a slot added
 * anywhere in the 60-minute window 22:30–23:29 came out INVERTED —
 * `23:00–00:00` or `23:30–00:30`, end sorting before start. The API's
 * `checkTimeConflict` compares raw minute offsets with no midnight
 * wrap-around, so such a block overlapped nothing at all, not even a
 * byte-identical copy of itself, and every repeat quick-add in that window
 * inserted another real row.
 *
 * The exhaustive sweep below is the point of this file: the original code
 * passed every hand-picked mid-morning example anyone would think to write.
 */

function at(hours: number, minutes: number): Date {
  const d = new Date(2026, 7, 16, hours, minutes, 0, 0);
  return d;
}

describe("quick-add slot times", () => {
  it("never produces an inverted or zero-length range, at any minute of the day", () => {
    const offenders: string[] = [];

    for (let hours = 0; hours < 24; hours++) {
      for (let minutes = 0; minutes < 60; minutes++) {
        const { startTime, endTime } = defaultSlotRange(at(hours, minutes));
        if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
          offenders.push(
            `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} -> ${startTime}-${endTime}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // The exact block the wife's iPhone kept duplicating. Pre-fix this returned
  // 23:00-00:00, which renders as the entirely innocent "11:00 PM - 12:00 AM".
  it("clamps the late-evening window to the end of the day instead of wrapping", () => {
    expect(defaultSlotRange(at(22, 30))).toEqual({
      startTime: "23:00",
      endTime: "23:59",
    });
    expect(defaultSlotRange(at(23, 0))).toEqual({
      startTime: "23:30",
      endTime: "23:59",
    });
    expect(defaultSlotRange(at(23, 29))).toEqual({
      startTime: "23:30",
      endTime: "23:59",
    });
  });

  // The second, quieter defect from the same wrap: at 23:30+ the START
  // collapsed to `1440 % 1440 = 0`, silently placing the slot at 00:00-01:00 —
  // the wrong end of the same day, so the user's block landed 23 hours from
  // where they asked for it.
  it("does not collapse a late start to the top of the day", () => {
    for (const minute of [30, 45, 59]) {
      const { startTime } = defaultSlotRange(at(23, minute));
      expect(startTime).not.toBe("00:00");
      expect(startTime).toBe("23:30");
    }
  });

  it("still rounds up to the next half hour during the day", () => {
    expect(defaultSlotStartTime(at(9, 0))).toBe("09:30");
    expect(defaultSlotStartTime(at(9, 15))).toBe("09:30");
    expect(defaultSlotStartTime(at(9, 30))).toBe("10:00");
    expect(defaultSlotStartTime(at(9, 59))).toBe("10:00");
  });

  it("still gives an ordinary daytime slot its full default hour", () => {
    expect(defaultSlotRange(at(9, 15))).toEqual({
      startTime: "09:30",
      endTime: "10:30",
    });
  });

  it("shortens rather than overflows a slot that would run past midnight", () => {
    expect(defaultSlotEndTime("23:30")).toBe("23:59");
    expect(defaultSlotEndTime("23:00")).toBe("23:59");
    expect(defaultSlotEndTime("21:00")).toBe("22:00");
  });
});
