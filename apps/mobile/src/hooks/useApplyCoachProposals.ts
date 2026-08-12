// Applying a Coach proposal batch. One implementation, used by both the
// Coach chat screen and the voice assistant, so a spoken change and a typed
// one go through exactly the same server call and the same cache
// invalidation.
//
// The endpoint already exists and already does the work: POST
// /coach/proposals/apply (packages/shared/src/api/coach.ts's
// `applyProposals`, backed by the API's coach-proposals module). It takes
// the whole batch, applies each action, and reports per-action results.
// Nothing here re-derives, re-validates or re-orders those actions —
// packages/shared/src/coach/proposals.ts has already normalised and
// validated them out of the model's stream, and a second opinion on this
// side would only be a second place to be wrong.
//
// Mutation, not a query, and deliberately NOT routed through the offline
// outbox: an "apply" is only meaningful against the conversation that
// produced it, and replaying one hours later on reconnect would mutate a
// user's schedule from a proposal they have long since forgotten agreeing
// to. Offline, this fails and says so.

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import type { CoachProposalAction, CoachProposalResult } from "@goalslot/shared";

import { apiClient } from "@/lib/api-client";
import { goalQueries, scheduleQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";

export interface ApplyProposalsInput {
  actions: CoachProposalAction[];
  /** The assistant message the proposal came from, when there is one. */
  sourceMessageId?: string;
}

/**
 * A batch can succeed in part — the server applies what it can rather than
 * rolling the lot back. Saying "3 of 4 changes applied" is the honest
 * report; a bare "failed" would send the user to undo work that landed.
 */
export function summariseProposalResults(results: readonly CoachProposalResult[]): {
  applied: number;
  failed: CoachProposalResult[];
  message: string;
} {
  const failed = results.filter((result) => !result.ok);
  const applied = results.length - failed.length;

  if (failed.length === 0) {
    return { applied, failed, message: applied === 1 ? "Change applied" : `${applied} changes applied` };
  }
  if (applied === 0) {
    const first = failed[0]?.error;
    return { applied, failed, message: first ? `Couldn't apply that: ${first}` : "Couldn't apply that change." };
  }
  return {
    applied,
    failed,
    message: `${applied} of ${results.length} changes applied. ${failed.length} couldn't be.`,
  };
}

/**
 * Every domain a proposal action can touch. Invalidated wholesale rather
 * than surgically: the action types span goals, tasks, schedule blocks and
 * time entries, several of them cascade server-side (a time entry moves a
 * goal's logged hours), and one batch can carry a mix. Working out the
 * minimal set per batch would be a lot of care spent to avoid four refetches
 * the user is already waiting on a round trip for.
 */
function invalidateEverythingAProposalCanTouch(): void {
  void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
  void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
  void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
  void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
}

export interface UseApplyCoachProposalsResult {
  apply: (input: ApplyProposalsInput) => Promise<string>;
  isApplying: boolean;
  /** Set when the most recent apply failed outright. Cleared on the next attempt. */
  error: string | null;
}

export function useApplyCoachProposals(): UseApplyCoachProposalsResult {
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ actions, sourceMessageId }: ApplyProposalsInput) => {
      const response = await apiClient.coach.applyProposals(actions, sourceMessageId);
      return response.data.results ?? [];
    },
  });

  const { mutateAsync } = mutation;

  const apply = useCallback(
    async (input: ApplyProposalsInput) => {
      setError(null);
      try {
        const results = await mutateAsync(input);
        invalidateEverythingAProposalCanTouch();
        const summary = summariseProposalResults(results);
        if (summary.applied === 0) {
          setError(summary.message);
          throw new Error(summary.message);
        }
        return summary.message;
      } catch (err) {
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : "Couldn't apply that change. Please try again.";
        setError(message);
        throw new Error(message);
      }
    },
    [mutateAsync],
  );

  return { apply, isApplying: mutation.isPending, error };
}
