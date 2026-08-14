// "Hey Siri, start timer in GoalSlot" — starts tracking against whichever
// schedule block is live right now.
//
// This intent cannot resolve "the active block" itself: `resolveActiveBlock`
// (packages/shared/src/scheduling/fire-time.ts) is pure TS operating on
// React-Query-loaded schedule data, and duplicating that logic in Swift is
// exactly what the feature brief says not to do. So `perform()` just opens
// the app to the Timer tab with `autostart=active` and lets JS resolve and
// start the session the same way the Today screen's "FOCUS NOW" card and the
// Timer screen's own auto-select-on-open effect already do.
//
// IMPORTANT — this alone does not yet make "just say it and it starts" true.
// app/(app)/timer.tsx's existing autostart effect only fires for
// `autostart === "1"` with an explicit `goalId` (the widget's case); a bare
// `autostart=active` is not handled there yet, and that file is outside this
// change's file ownership. See notesForCoordinator for the exact gap and the
// options to close it. Until then this degrades gracefully: the Timer tab
// opens with the active block pre-selected (via the existing auto-select
// effect) and the user taps Start once by hand.
//
// See AppShortcuts.swift for why this whole mechanism (App Intents +
// AppShortcutsProvider, "Hey Siri" not a custom wake word) is the right one,
// and for the target-membership caveat this new file needs before it will
// actually compile into the app.

import AppIntents
import UIKit

struct StartTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Timer"
    static var description = IntentDescription(
        "Starts tracking time against your currently scheduled block."
    )
    // Forces the app to the foreground so RCTLinkingManager's
    // `application(_:open:options:)` sees the `open(url:)` call below —
    // mirrors how the widget's tap-through already behaves.
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "goalslot://timer?autostart=active") else {
            throw StartTimerIntentError.invalidURL
        }
        await UIApplication.shared.open(url)
        return .result()
    }
}

enum StartTimerIntentError: Error, CustomLocalizedStringResourceConvertible {
    case invalidURL

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .invalidURL:
            return "Couldn't open GoalSlot to start the timer."
        }
    }
}
