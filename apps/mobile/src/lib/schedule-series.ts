// Works out which OTHER blocks an edit or delete should be able to reach.
//
// THE PROBLEM THIS SOLVES. `seriesId` is `@default(uuid())` per ROW in the
// API's Prisma schema, so a block only belongs to a real series if something
// deliberately gave it a shared id at creation time. Exactly two things ever
// do: applying a template (grouped server-side by "shape"), and picking
// several weekdays in one go in the create sheet (ScheduleBlockSheet's
// `sharedSeriesId`, mirroring the web modal).
//
// Everything else produces five unrelated rows that merely LOOK like a
// series: adding Monday, then Tuesday, then Wednesday one at a time; the
// title-only quick-add; and — the big one — every block created before
// multi-day create existed, which is most of what any current user already
// has. Those blocks each carry their own unique seriesId, so
// `updateScope: 'series'` reaches precisely one of them and the user is still
// editing "Reading" five times. That is the actual complaint.
//
// Re-parenting them into one real series is NOT possible from here: the API's
// update path destructures `seriesId` out and discards it
// (schedule.service.ts), so no PUT can change a block's series, and the only
// alternative — delete and recreate with a shared id — would mint new block
// ids and orphan the TimeEntry and Task rows that reference them. A backfill
// needs a server-side migration; see the PR.
//
// So instead of changing the DATA, this widens what the UI is willing to
// treat as "the same thing". A block's linked set is:
//
//   - its real series, when it has one (>1 block sharing `seriesId`), or
//   - failing that, every block matching on SHAPE — same title, same start,
//     same end.
//
// The shape key deliberately matches templates.service.ts's own grouping
// rule (title + startTime + endTime), so "what the app calls one series"
// means the same thing whether the blocks came from a template or were typed
// in by hand. Day is excluded, since differing days is the entire point.

import type { ScheduleBlock } from "@goalslot/shared";

export type LinkedBlocksKind =
  /** One block, nothing else like it. */
  | "solo"
  /** A real series — every member shares a `seriesId`, so the API can fan out server-side. */
  | "series"
  /** Look-alikes with unrelated seriesIds. Only the client can fan these out, one call each. */
  | "lookalike";

export interface LinkedBlocks {
  kind: LinkedBlocksKind;
  /** Always includes the block itself. Sorted by day so prompts read Sun→Sat. */
  members: ScheduleBlock[];
}

/** Same fields templates.service.ts groups on, minus the day. */
function shapeKey(block: ScheduleBlock): string {
  return `${block.title.trim().toLowerCase()}|${block.startTime}|${block.endTime}`;
}

export function findLinkedBlocks(
  block: ScheduleBlock,
  allBlocks: readonly ScheduleBlock[],
): LinkedBlocks {
  const byDay = (a: ScheduleBlock, b: ScheduleBlock) => a.dayOfWeek - b.dayOfWeek;

  const series = allBlocks.filter((b) => b.seriesId === block.seriesId);
  if (series.length > 1) {
    return { kind: "series", members: [...series].sort(byDay) };
  }

  const key = shapeKey(block);
  const lookAlikes = allBlocks.filter((b) => shapeKey(b) === key);
  if (lookAlikes.length > 1) {
    return { kind: "lookalike", members: [...lookAlikes].sort(byDay) };
  }

  return { kind: "solo", members: [block] };
}
