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
import { getErrorMessage } from "@/lib/get-error-message";
import { goalQueries, journalQueries, noteQueries, scheduleQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";

export interface ApplyProposalsInput {
  actions: CoachProposalAction[];
  /** The assistant message the proposal came from, when there is one. */
  sourceMessageId?: string;
  /**
   * Target id of every DELETE_* action in `actions`, when the user has been
   * shown those exact rows and confirmed them. Without it the API falls back
   * to blast-radius caps and refuses a batch above 10 deletes, or 3 goal
   * deletes, which is what a real "delete everything not linked to anything"
   * cleanup routinely exceeds.
   *
   * Strict on the server: supplying it at all means every delete in the batch
   * must be named. The caller omits it rather than sending a partial list.
   */
  confirmDeletions?: string[];
}

/** What the card shows once an apply has landed at least in part. */
export interface ApplyFeedback {
  message: string;
  /** True when something failed or was only partly done: never shown as a clean "Applied". */
  partial: boolean;
  /** One line per action that failed or carries a caveat, with the server's reason. */
  details: string[];
}

const NOT_ATTEMPTED = /^Not applied, because/;

function describeResult(result: CoachProposalResult): string {
  const what = result.label ?? "A change";
  if (result.ok) return `${what}: ${result.warning ?? "done"}`;
  return `${what}: ${result.error ?? "failed"}`;
}

/**
 * A batch can succeed in part. Saying exactly which changes did not land,
 * and why, is the honest report; a bare count (or a green "Applied") sent the
 * user to the Schedule tab to find out what was missing, and a "Done" card
 * after failed creates is how the original bug report started.
 *
 * A refused batch (the API wrote nothing) and a batch where every action
 * failed both count as "nothing applied", and the most specific reason is
 * picked, not the "not attempted because another change failed" filler.
 */
export function summariseProposalResults(results: readonly CoachProposalResult[]): {
  applied: number;
  failed: CoachProposalResult[];
  message: string;
  partial: boolean;
  details: string[];
} {
  const failed = results.filter((result) => !result.ok);
  const applied = results.length - failed.length;
  const caveats = results.filter((result) => result.ok && result.warning && !result.alreadyDone);
  const details = [...failed.filter((r) => !NOT_ATTEMPTED.test(r.error ?? "")), ...caveats].map(describeResult);

  if (failed.length === 0) {
    const base = applied === 1 ? "Change applied" : `${applied} changes applied`;
    return {
      applied,
      failed,
      partial: caveats.length > 0,
      details,
      message: caveats.length > 0 ? `${base}, with ${caveats.length === 1 ? "a caveat" : "caveats"}.` : base,
    };
  }
  if (applied === 0) {
    const reason = failed.find((r) => r.error && !NOT_ATTEMPTED.test(r.error)) ?? failed[0];
    const nothing = failed.some((r) => r.skipped) ? "Nothing was changed. " : "";
    const what = reason?.label ? `${reason.label}: ` : "";
    return {
      applied,
      failed,
      partial: true,
      details,
      message: reason?.error ? `${nothing}${what}${reason.error}` : "Couldn't apply that change.",
    };
  }
  return {
    applied,
    failed,
    partial: true,
    details,
    message: `${applied} of ${results.length} changes applied. ${failed.length} couldn't be.`,
  };
}

/**
 * Every domain a proposal action can touch. Invalidated wholesale rather
 * than surgically: the action types span goals, tasks, schedule blocks, time
 * entries and journal entries, several of them cascade server-side (a time
 * entry moves a goal's logged hours), and one batch can carry a mix. Working
 * out the minimal set per batch would be a lot of care spent to avoid five
 * refetches the user is already waiting on a round trip for.
 *
 * The journal keys cover APPEND_JOURNAL_ENTRY, and the whole `['journal']`
 * root is invalidated rather than just the one day: the action's date is not
 * necessarily today (the user can ask for a past day), and the Journal tab
 * reads both a by-date entry and a date-range list.
 *
 * The notes root covers APPEND_NOTE_CONTENT — invalidated wholesale (list +
 * every cached detail) for the same reason as the journal: the action names
 * its target by title, not by the id this cache is keyed on, so there is no
 * cheaper "just that one note" invalidation to do from here. Reopening the
 * page it landed on shows the new paragraph either way.
 */
function invalidateEverythingAProposalCanTouch(): void {
  void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
  void queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all });
  void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
  void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
  void queryClient.invalidateQueries({ queryKey: journalQueries.journalQueries.all });
  void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.all });
}

export interface UseApplyCoachProposalsResult {
  apply: (input: ApplyProposalsInput) => Promise<ApplyFeedback>;
  isApplying: boolean;
  /** Set when the most recent apply failed outright. Cleared on the next attempt. */
  error: string | null;
}

export function useApplyCoachProposals(): UseApplyCoachProposalsResult {
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ actions, sourceMessageId, confirmDeletions }: ApplyProposalsInput) => {
      const response = await apiClient.coach.applyProposals(actions, sourceMessageId, confirmDeletions);
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
        return { message: summary.message, partial: summary.partial, details: summary.details };
      } catch (err) {
        const message = getErrorMessage(err, "Couldn't apply that change. Please try again.");
        setError(message);
        throw new Error(message);
      }
    },
    [mutateAsync],
  );

  return { apply, isApplying: mutation.isPending, error };
}
