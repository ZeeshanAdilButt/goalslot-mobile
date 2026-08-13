// Building blocks for app/(app)/settings.tsx. Each detail form is a sheet
// rather than a route, so Settings stays one entry in the router and this
// folder holds everything it opens.
//
// Deliberately NOT re-exported from `src/components/index.ts`: the sheets in
// here import the state primitives (LoadingState/ErrorState) and the UI
// primitives out of that barrel's own modules, and folding these back into it
// would close the loop.

export * from "./AiKeySheet";
export * from "./ChangePasswordSheet";
// Not opened from the Settings list: `CoachBudgetNotice` mounts on whichever
// screen surfaced the budget error (Coach chat, voice dock) and opens
// `IncreaseBudgetSheet` itself. They live here because they are the same
// settings-sheet pattern writing the same endpoint as AiKeySheet.
export * from "./CoachBudgetNotice";
export * from "./IncreaseBudgetSheet";
export * from "./CoachProfileSheet";
export * from "./DeleteAccountSheet";
export * from "./EditProfileSheet";
export * from "./SettingsList";
export * from "./SettingsSheet";
