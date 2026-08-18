// Task-domain building blocks. Unlike src/components/lists (shared across
// Goals/Tasks/Categories/Notes), everything here knows what a Task is.
// Mostly used only by app/(app)/tasks.tsx, with a couple of app-wide
// exceptions that still belong here because of that Task-domain knowledge:
// TaskRemindersSync (mounted once in app/(app)/_layout.tsx) and
// TaskDigestHoursPicker (used from app/(app)/notification-settings.tsx,
// same relationship JournalReminderTimePicker has to components/journal/).
//
// Each file's header comment cites the dw-time-web file it mirrors.

export * from "./board-columns";
export * from "./due-date";
export * from "./task-actions";
export * from "./TaskBoard";
export * from "./TaskBoardCard";
export * from "./TaskDigestHoursPicker";
export * from "./TaskGoalFilter";
export * from "./TaskMetaChips";
export * from "./TaskRemindersSync";
