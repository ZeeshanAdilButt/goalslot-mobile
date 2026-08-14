// App Shortcuts registration for GoalSlot's Siri / Shortcuts voice triggers.
//
// This is the App-Store-safe mechanism for "say something and GoalSlot does
// the thing": iOS has no API for a third-party app to register its own
// always-on wake word (that would require bundling a continuously-listening
// on-device wake-word engine). What IS available from iOS 16 on is App
// Intents + AppShortcutsProvider, which lets the OS surface these actions to
// Siri and to the Shortcuts app under the *system* wake word — the user says
// "Hey Siri, <phrase>", where <phrase> must embed the app's name per Apple's
// AppShortcut requirements (see each `phrases` array below). This lives
// entirely in the main app target — no Intents Extension, no Siri
// entitlement, no new Info.plist keys are needed for AppShortcutsProvider
// (that's only required for older SiriKit domain intents).
//
// Each intent's `perform()` opens a `goalslot://` URL via
// `UIApplication.shared.open(url)` — the same hand-off mechanism the
// GoalSlotWidget's `Link(destination:)`/`.widgetURL(...)` already use, and
// the same `RCTLinkingManager` path AppDelegate.swift's
// `application(_:open:options:)` already wires up. See
// src/lib/deep-links.ts for the route strings these intents build.
//
// NOTE: this file must be added to the "GoalSlot" app target's Sources
// build phase before it will compile into the app — the main target is a
// plain (non-file-system-synchronized) PBXGroup, so simply adding this file
// to the `ios/GoalSlot/` folder does not do that automatically the way it
// would for the widget target. See plugins/withSiriShortcuts.js for the fix
// (a config plugin using `xcode`'s `project.addSourceFile`, applied at every
// `expo prebuild`) — do not hand-edit project.pbxproj for this.
//
// StartTimerForGoalIntent is deliberately NOT registered here as an
// AppShortcut. Its `goalName` parameter is free text (see that file's own
// header for why — it's handed untouched to the app's existing fuzzy
// matcher rather than modeled as an AppEntity), and Xcode's
// ExtractAppIntentsMetadata build step hard-fails compilation the moment a
// phrase references a parameter via `\(\.$param)` unless that parameter's
// type conforms to AppEntity or AppEnum: "Invalid parameter type. AppEntity
// and AppEnum are the only allowed types for goalName". A plain `String`
// can't satisfy that without the heavier EntityQuery-backed redesign the
// intent's own header already ruled out. The intent itself still compiles
// and is fully usable (e.g. built as a step in the Shortcuts app); it's
// just not offered as a magic, auto-suggested "Hey Siri" phrase the way the
// other two are.

import AppIntents

struct GoalSlotShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartTimerIntent(),
            phrases: [
                "Start timer in \(.applicationName)",
                "Start my timer in \(.applicationName)",
            ],
            shortTitle: "Start Timer",
            systemImageName: "play.circle"
        )
        AppShortcut(
            intent: TalkAboutMyDayIntent(),
            phrases: [
                "Talk about my day in \(.applicationName)",
                "Let's talk about my day in \(.applicationName)",
            ],
            shortTitle: "Talk About My Day",
            systemImageName: "text.bubble"
        )
    }
}
