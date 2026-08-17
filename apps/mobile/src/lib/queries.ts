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
  createCoachSettingsQueries,
  createGoalQueries,
  createInstructionsQueries,
  createJournalQueries,
  createLabelQueries,
  createMessagingQueries,
  createNoteQueries,
  createNotificationQueries,
  createScheduleQueries,
  createSharingQueries,
  createTaskQueries,
  createTemplateQueries,
  createTimeEntryQueries,
  createTimerSessionQueries,
} from "@goalslot/shared";

import { apiClient } from "./api-client";
import { messagingClient } from "./messaging-client";

export const coachQueries = createCoachQueries(apiClient.coach);
// The BYOK key + habits profile, read by the Settings screen's sheets. Keys
// live under the same `['coach']` root as the chat queries above — see
// packages/shared/src/queries/coach-settings.ts for why that matters.
export const coachSettingsQueries = createCoachSettingsQueries(apiClient.coachSettings);
export const goalQueries = createGoalQueries(apiClient.goals);
export const taskQueries = createTaskQueries(apiClient.tasks);
export const scheduleQueries = createScheduleQueries(apiClient.schedule);
export const categoryQueries = createCategoryQueries(apiClient.categories);
export const labelQueries = createLabelQueries(apiClient.labels);
export const timeEntryQueries = createTimeEntryQueries(apiClient.timeEntries);
// The cross-device active timer session a coach voice/chat action may have
// started server-side — see app/(app)/timer.tsx's use of this for why the
// Time Tracker screen has to poll it rather than trust its own local store
// as the only source of truth.
export const timerSessionQueries = createTimerSessionQueries(apiClient.timerSession);
export const journalQueries = createJournalQueries(apiClient.journal);
export const noteQueries = createNoteQueries(apiClient.notes);
// Two services in one factory on purpose: conversations/messages come from
// jiffy-messaging, but the contact picker's names come from GoalSlot's own
// sharing directory. Keying both under ['messaging'] means signing out or
// losing the messaging token clears the feature with a single invalidate.
export const messagingQueries = createMessagingQueries(messagingClient, apiClient.sharing);
// The Mentees screen's own directory read (who shared their data with the
// signed-in user) plus a mentee's shared time entries/goals — see
// packages/shared/src/queries/sharing.ts for why this is a separate key
// namespace from messaging's `contacts()` above rather than reusing it.
export const sharingQueries = createSharingQueries(apiClient.sharing);
// Assign/list instructions a mentor gives a mentee.
export const instructionsQueries = createInstructionsQueries(apiClient.instructions);
// In-app notification history — bell icon badge + the notification-center
// list screen (app/(app)/notifications.tsx). Same server-side `Notification`
// rows every dispatch already writes; see packages/shared/src/api/notifications.ts.
export const notificationQueries = createNotificationQueries(apiClient.notifications);
// Library: browse curated community templates and read one in full. Import
// and sync are one-off mutations, not wrapped here — see
// packages/shared/src/queries/templates.ts's header for why, and
// app/(app)/library/[id].tsx for the call sites.
export const templateQueries = createTemplateQueries(apiClient.templates);
