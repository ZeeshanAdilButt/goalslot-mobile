// What an edit or delete is allowed to reach.
//
// The case that matters is "lookalike": five separately-created "Reading"
// blocks, each with its own `seriesId` because Prisma defaults that column
// per row. They are visibly one routine and the user expects to edit them
// once — but `updateScope: 'series'` reaches exactly one of them, because
// there is no shared key. Recognising them by shape is what makes the whole
// feature work on data that already exists.

import type { ScheduleBlock } from "@goalslot/shared";

import { findLinkedBlocks } from "./schedule-series";

function block(overrides: Partial<ScheduleBlock> & { id: string }): ScheduleBlock {
  return {
    title: "Reading",
    startTime: "06:00",
    endTime: "07:00",
    dayOfWeek: 1,
    category: "Growth",
    color: "#FFD700",
    isRecurring: true,
    isPrivate: false,
    // Unique per row unless a test says otherwise — exactly what the API does.
    seriesId: `series-${overrides.id}`,
    ...overrides,
  } as ScheduleBlock;
}

describe("findLinkedBlocks", () => {
  it("treats a genuine shared-seriesId group as a series", () => {
    const blocks = [1, 2, 3].map((day) => block({ id: `r${day}`, dayOfWeek: day, seriesId: "shared" }));

    const linked = findLinkedBlocks(blocks[0], blocks);

    expect(linked.kind).toBe("series");
    expect(linked.members.map((b) => b.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("recognises look-alikes that each carry their own seriesId", () => {
    // Added one day at a time, or created before multi-day create existed.
    const blocks = [1, 2, 3, 4, 5].map((day) => block({ id: `r${day}`, dayOfWeek: day }));

    const linked = findLinkedBlocks(blocks[0], blocks);

    expect(linked.kind).toBe("lookalike");
    expect(linked.members).toHaveLength(5);
  });

  it("prefers the real series when a block has one, even if look-alikes exist", () => {
    const series = [1, 2].map((day) => block({ id: `s${day}`, dayOfWeek: day, seriesId: "shared" }));
    const stray = block({ id: "stray", dayOfWeek: 5 });

    const linked = findLinkedBlocks(series[0], [...series, stray]);

    // A deliberately-created series is a stronger signal than shape, so the
    // stray look-alike is not swept into a server-side `updateScope: series`
    // that could never have reached it anyway.
    expect(linked.kind).toBe("series");
    expect(linked.members.map((b) => b.id)).toEqual(["s1", "s2"]);
  });

  it("does not link blocks that merely share a title", () => {
    const morning = block({ id: "a", dayOfWeek: 1, startTime: "06:00", endTime: "07:00" });
    const evening = block({ id: "b", dayOfWeek: 1, startTime: "21:00", endTime: "22:00" });

    // Same name, different routine. Editing one must not silently move the
    // other — times are part of the identity.
    expect(findLinkedBlocks(morning, [morning, evening]).kind).toBe("solo");
  });

  it("matches titles case- and whitespace-insensitively", () => {
    const a = block({ id: "a", dayOfWeek: 1, title: "Reading" });
    const b = block({ id: "b", dayOfWeek: 2, title: "  reading " });

    expect(findLinkedBlocks(a, [a, b]).members).toHaveLength(2);
  });

  it("reports a one-off block as solo", () => {
    const only = block({ id: "only" });
    const unrelated = block({ id: "gym", title: "Gym", startTime: "18:00", endTime: "19:00" });

    const linked = findLinkedBlocks(only, [only, unrelated]);

    expect(linked.kind).toBe("solo");
    expect(linked.members.map((b) => b.id)).toEqual(["only"]);
  });

  it("always includes the block itself and orders members Sunday-first", () => {
    const blocks = [5, 0, 3].map((day) => block({ id: `r${day}`, dayOfWeek: day }));

    const linked = findLinkedBlocks(blocks[0], blocks);

    // The prompt says "Changes Sun, Wed, Fri" — it has to read in week order.
    expect(linked.members.map((b) => b.dayOfWeek)).toEqual([0, 3, 5]);
    expect(linked.members).toContain(blocks[0]);
  });
});
