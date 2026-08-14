// Query-key factory + queryOptions for instructions, same shape as
// ./sharing. Assign/complete stay plain `api.instructions.*` calls at the
// mutation call site (matching how goals/tasks/notes do writes in this
// codebase) — this only covers the two list reads.

import { queryOptions } from '@tanstack/react-query'

import type { InstructionsApi } from '../api/instructions'

export function createInstructionsQueries(api: InstructionsApi) {
  const instructionsQueries = {
    all: ['instructions'] as const,
    assignedByMe: () => [...instructionsQueries.all, 'assigned-by-me'] as const,
    assignedToMe: () => [...instructionsQueries.all, 'assigned-to-me'] as const,
  }

  return {
    instructionsQueries,

    /** Instructions the signed-in user (a mentor) has assigned to mentees. */
    assignedByMe: () =>
      queryOptions({
        queryKey: instructionsQueries.assignedByMe(),
        queryFn: async () => (await api.listAssignedByMe()).data,
      }),

    /** Instructions assigned to the signed-in user (a mentee) by a mentor. */
    assignedToMe: () =>
      queryOptions({
        queryKey: instructionsQueries.assignedToMe(),
        queryFn: async () => (await api.listAssignedToMe()).data,
      }),
  }
}

export type InstructionsQueries = ReturnType<typeof createInstructionsQueries>
