// Built against ./goals.ts / ./journal.ts's exact factory pattern. Only
// wraps the REST half of the Coach API (chat history) — streaming a reply
// is a stateful, multi-chunk operation, not a fetchable resource, so it's
// called imperatively via apiClient.coach.streamChat (see client.ts)
// straight from the screen, the same way web's ChatSection calls
// coachApi.streamChat directly in its handleSend instead of through
// useQuery/useMutation.

import { queryOptions } from '@tanstack/react-query'

import type { CoachApi } from '../api/coach'
import type { CoachMessageDto } from '../api/coach'

export function createCoachQueries(coachApi: CoachApi) {
  const coachQueries = {
    all: ['coach'] as const,
    chat: (scopeKey: string) => [...coachQueries.all, 'chat', scopeKey] as const,
  }

  const fetchChatHistory = async (scopeKey: string): Promise<CoachMessageDto[]> => {
    const res = await coachApi.getChatHistory(scopeKey)
    return res.data
  }

  return {
    coachQueries,
    fetchChatHistory,
    chat: (scopeKey: string) =>
      queryOptions({
        queryKey: coachQueries.chat(scopeKey),
        queryFn: () => fetchChatHistory(scopeKey),
      }),
  }
}
