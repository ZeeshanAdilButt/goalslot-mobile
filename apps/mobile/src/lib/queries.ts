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
  createCoachQueries,
  createGoalQueries,
  createJournalQueries,
  createLabelQueries,
  createMessagingQueries,
  createNoteQueries,
  createScheduleQueries,
  createTaskQueries,
  createTimeEntryQueries,
} from "@goalslot/shared";

import { apiClient } from "./api-client";
import { messagingClient } from "./messaging-client";

export const coachQueries = createCoachQueries(apiClient.coach);
export const goalQueries = createGoalQueries(apiClient.goals);
export const taskQueries = createTaskQueries(apiClient.tasks);
export const scheduleQueries = createScheduleQueries(apiClient.schedule);
export const categoryQueries = createCategoryQueries(apiClient.categories);
export const labelQueries = createLabelQueries(apiClient.labels);
export const timeEntryQueries = createTimeEntryQueries(apiClient.timeEntries);
export const journalQueries = createJournalQueries(apiClient.journal);
export const noteQueries = createNoteQueries(apiClient.notes);
// Two services in one factory on purpose: conversations/messages come from
// jiffy-messaging, but the contact picker's names come from GoalSlot's own
// sharing directory. Keying both under ['messaging'] means signing out or
// losing the messaging token clears the feature with a single invalidate.
export const messagingQueries = createMessagingQueries(messagingClient, apiClient.sharing);
