// Drop-in ErrorState for a failed `useQuery`, that tells "the server
// genuinely rejected this" apart from "this device has no network path to
// the server at all" — see src/lib/query-error.ts's header for the bug this
// fixes and why `hasResponse` is the right signal.
//
// Deliberately does NOT read `isPending`/`data` itself and decide whether to
// render at all: every screen in this app already gates its error branch
// with its own `isError && !data` (goals.tsx, tasks.tsx, schedule.tsx) —
// that "don't blow away good cached data" discipline stays visible and
// greppable at each call site instead of being hidden inside a shared
// component. This only replaces the LAST mile: once a screen has decided an
// error panel is warranted, which panel.

import { ErrorState, type ErrorStateProps } from "./ErrorState";
import { describeQueryError } from "@/lib/query-error";

export interface QueryErrorStateProps
  extends Pick<ErrorStateProps, "onRetry" | "retryLabel" | "compact" | "style" | "footer"> {
  /** The query's `error` value. Only its shape (does it have `.response`?) is inspected. */
  error: unknown;
  /** Shown when the server actually responded and rejected the request. */
  message: string;
  /** Shown when the request never reached the server. Defaults to a generic "check your connection" line. */
  offlineMessage?: string;
}

export function QueryErrorState({ error, message, offlineMessage, ...rest }: QueryErrorStateProps) {
  const content = describeQueryError(error, message, offlineMessage);
  return <ErrorState {...content} {...rest} />;
}
