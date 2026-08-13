// Pure classification for the FREE-plan daily-entry cap
// (dw-time-api/src/modules/auth/plan-limits.ts: FREE.maxTasksPerDay = 3),
// used two places in app/(app)/timer.tsx: warning before a session starts
// that it may not be savable, and telling a save that failed BECAUSE OF the
// cap apart from any other kind of failure once it happens.
//
// Split out of timer.tsx (rather than inlined) so both call sites share one
// definition and so the classification itself — not the Alert copy or the
// store-preservation logic around it — is what's under test here.

/**
 * `POST /time-entries` (dw-time-api's time-entries.service.ts) throws
 * exactly one 403 today: AuthService#checkPlanLimit's ForbiddenException
 * once the caller's `tasksPerDay` limit is reached. A 403 on this endpoint
 * is therefore unambiguous evidence of the plan cap, not a guess based on
 * response text — which could be reworded or localized without warning, and
 * which this function deliberately never inspects.
 */
export function isPlanLimitError(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } } | undefined)?.response?.status;
  return status === 403;
}

/**
 * True once today's tracked-entry count has reached (or already passed) the
 * caller's plan limit.
 *
 * `maxTasksPerDay` arrives as `null`/`undefined` for an unlimited plan:
 * the API computes it as JS `Infinity` and `JSON.stringify(Infinity)` is
 * `null` (see settings.tsx's `formatLimit` for the same rule applied to
 * display text). Anything non-finite therefore means "no cap", never "a cap
 * of zero" — the `Number.isFinite` guard is load-bearing, not decoration.
 */
export function hasReachedDailyEntryCap(
  todaysEntryCount: number,
  maxTasksPerDay: number | null | undefined,
): boolean {
  return Number.isFinite(maxTasksPerDay) && todaysEntryCount >= (maxTasksPerDay as number);
}
