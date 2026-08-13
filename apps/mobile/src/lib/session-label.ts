// The single definition of what an unattributed — or not-yet-resolved —
// tracked session is called. Shared by every place mobile has to name one:
// the Time Tracker screen (app/(app)/timer.tsx), its ongoing shade
// notification (components/timer/useTimerNotification.ts), its periodic
// "still tracking?" reminders (timer-reminders.ts), and the tracking voice
// button's one-shot "log N minutes" path (components/voice/TrackerVoiceButton.tsx).
//
// Matches dw-time-web and dw-time-api's wording for the same concept (web's
// entry-title.ts, the API's active-timer.constants.ts DEFAULT_TASK_NAME).
// Mobile used to say "Focus session" here instead — a different string for
// the same thing — which meant an unattributed session tracked on both
// mobile and another platform split into two buckets in any report that
// groups by task name, instead of the one bucket it should be.
//
// A single exported constant, rather than four local copies kept in sync by
// comment, is what makes that regression structurally impossible instead of
// just documented against.
export const DEFAULT_SESSION_LABEL = "Untitled session";
