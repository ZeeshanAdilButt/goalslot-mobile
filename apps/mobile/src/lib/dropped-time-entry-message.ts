// Split out from offline.ts so this pure formatting logic can be unit tested
// without pulling in offline.ts's side-effecting imports (api-client,
// async-storage-adapter, messaging-client, NetInfo) — same reasoning as
// derive-online.ts next to it.

import { formatDuration, type CreateTimeEntryInput } from "@goalslot/shared";

/**
 * Message for `time-entry-create`'s `onDropped` hook (see offline.ts) — fires
 * when a queued time entry's replay is definitively rejected by the server,
 * most commonly a FREE-plan user who already hit the daily entry cap by the
 * time connectivity returned and the queued entry synced (through another
 * device, the web app, or a different queued entry landing first).
 *
 * Deliberately doesn't name a specific reason: the rejection could be the
 * daily cap, a since-deleted goal/task the entry pointed at, or a validation
 * rule, and none of those are things replaying the same payload again would
 * fix — the entry is gone either way, so the message just says so.
 */
export function droppedTimeEntryMessage(payload: CreateTimeEntryInput): string {
  return `${formatDuration(payload.duration)} tracked for "${payload.taskName}" couldn't be saved.`;
}
