// Wires the shared package's per-domain query-key/queryFn factories to this
// app's `apiClient`, once, so every screen (and this repo's own
// src/hooks/useQuickAdd.ts) imports the same instances instead of each
// calling `createGoalQueries(apiClient.goals)` separately. The factories are
// pure (same api client in -> identical query keys out), so a second call
// site wouldn't produce inconsistent keys, but a single shared instance is
// one less thing to get subtly wrong when five screens start depending on
// this.

import {
  createCategoryQueries,
  createGoalQueries,
  createJournalQueries,
  createScheduleQueries,
  createTaskQueries,
  createTimeEntryQueries,
} from "@goalslot/shared";

import { apiClient } from "./api-client";

export const goalQueries = createGoalQueries(apiClient.goals);
export const taskQueries = createTaskQueries(apiClient.tasks);
export const scheduleQueries = createScheduleQueries(apiClient.schedule);
export const categoryQueries = createCategoryQueries(apiClient.categories);
export const timeEntryQueries = createTimeEntryQueries(apiClient.timeEntries);
export const journalQueries = createJournalQueries(apiClient.journal);
