// Query options for the two Coach surfaces that live in Settings. Built
// against ./coach.ts's factory pattern.
//
// Query keys sit under the same `['coach']` root the chat queries use and
// match web's own keys exactly (`['coach','byok-key']` /
// `['coach','habits-profile']`, see dw-time-web/src/features/settings/hooks).
// That shared root is load-bearing: removing a BYOK key changes which model —
// or whether any model — answers a chat, so `invalidateQueries({ queryKey:
// coachSettingsQueries.all })` after a key mutation drops the chat caches too,
// which is what web does and why it does it.

import { queryOptions } from '@tanstack/react-query'

import type { CoachByokState, CoachHabitsProfile, CoachSettingsApi } from '../api/coach-settings'

export function createCoachSettingsQueries(coachSettingsApi: CoachSettingsApi) {
  const coachSettingsQueries = {
    all: ['coach'] as const,
    byokKey: () => ['coach', 'byok-key'] as const,
    habitsProfile: () => ['coach', 'habits-profile'] as const,
  }

  const fetchByokKey = async (): Promise<CoachByokState> => {
    const res = await coachSettingsApi.getByokKey()
    return res.data
  }

  const fetchHabitsProfile = async (): Promise<CoachHabitsProfile> => {
    const res = await coachSettingsApi.getHabitsProfile()
    return res.data
  }

  return {
    coachSettingsQueries,
    fetchByokKey,
    fetchHabitsProfile,
    byokKey: () =>
      queryOptions<CoachByokState>({
        queryKey: coachSettingsQueries.byokKey(),
        queryFn: fetchByokKey,
      }),
    habitsProfile: () =>
      queryOptions<CoachHabitsProfile>({
        queryKey: coachSettingsQueries.habitsProfile(),
        queryFn: fetchHabitsProfile,
      }),
  }
}
