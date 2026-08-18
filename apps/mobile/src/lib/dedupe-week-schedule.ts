// Defensive belt-and-suspenders: drops duplicate-id blocks from a WeekSchedule
// at render time.
//
// This is NOT a substitute for fixing genuine data-layer duplication (two
// distinct rows with distinct ids both landing on the same day/time — see
// quick-add-slot-times.ts and its commit message for the confirmed causes:
// the API's checkTimeConflict not handling midnight-wrapped ranges, and
// schedule.tsx's restoreBlocks Undo path previously replaying schedule
// creates under a fresh idempotency key instead of the one the original
// attempt used). Real duplicate ROWS still exist until a server-side cleanup
// runs. What this DOES catch is the same block id appearing twice in
// `GET /schedule/week`'s response — e.g. a stale react-query cache merge, an
// optimistic-update race that appends before the refetch replaces, or any
// future bug in a code path this investigation didn't find — so the UI fails
// safe (renders once) instead of visibly doubling a block that is, from the
// user's point of view, one thing.
//
// Keeps the LAST occurrence of each id within a day, on the reasoning that a
// later entry in the array is more likely to be the fresher/optimistic one
// than the first.

import type { ScheduleBlock, WeekSchedule } from "@goalslot/shared";

function dedupeBlocksById(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const byId = new Map<string, ScheduleBlock>();
  for (const block of blocks) {
    byId.set(block.id, block);
  }
  return Array.from(byId.values());
}

export function dedupeWeekSchedule(week: WeekSchedule | undefined): WeekSchedule | undefined {
  if (!week) return week;
  const deduped: WeekSchedule = {};
  for (const [day, blocks] of Object.entries(week)) {
    deduped[Number(day)] = dedupeBlocksById(blocks);
  }
  return deduped;
}
