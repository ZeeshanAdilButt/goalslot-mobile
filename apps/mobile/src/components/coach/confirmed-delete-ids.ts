// Which proposal actions destroy something, and how to confirm them per item.
//
// Kept in a plain module rather than inside CoachProposalCard.tsx so it can be
// tested without pulling in the React Native component tree (same reason as
// note-title-preflight.ts next door).
//
// The delete set MUST match DESTRUCTIVE_COACH_ACTION_TYPES in the API's
// src/modules/coach-ai/safety/action-safety.ts. A type the API counts as
// destructive but this set omits would be left out of `confirmDeletions`,
// and because the API reads that field strictly the entire batch would then
// be rejected.

import type { CoachProposalAction, CoachProposalActionType } from "@goalslot/shared";

export const DESTRUCTIVE_TYPES = new Set<CoachProposalActionType>([
  "DELETE_GOAL",
  "DELETE_SCHEDULE_BLOCK",
  "DELETE_TIME_ENTRY",
  "DELETE_TASK",
]);

export function isDestructiveAction(type: CoachProposalActionType): boolean {
  return DESTRUCTIVE_TYPES.has(type);
}

/**
 * Target ids of every delete in the batch, or undefined when the batch has no
 * deletes or any delete is missing an id.
 *
 * All-or-nothing on purpose. The API treats the presence of `confirmDeletions`
 * as "this client confirms deletes per item", so a partial list fails the whole
 * batch rather than just the unnamed action. Returning undefined instead falls
 * back to the server's count caps, which is the previous behaviour and still
 * applies a batch that is small enough (10 deletes, 3 of them goals).
 */
export function confirmedDeleteIds(
  actions: readonly CoachProposalAction[],
): string[] | undefined {
  const deletes = actions.filter((action) => DESTRUCTIVE_TYPES.has(action.type));
  if (deletes.length === 0) return undefined;
  const ids = deletes
    .map((action) => action.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.length === deletes.length ? ids : undefined;
}
