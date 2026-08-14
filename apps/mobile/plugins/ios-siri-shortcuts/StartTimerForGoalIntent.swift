// "Hey Siri, start timer for reading in GoalSlot" — starts tracking against
// a named goal/task, fuzzy-matched from the spoken words.
//
// `goalName` is a plain free-text `String` parameter, not an AppEntity/
// EntityQuery-backed one. That's deliberate: an AppEntity parameter needs a
// Swift `EntityQuery` that can list/resolve candidate goals and tasks during
// Siri's parameter-resolution phase, which means either duplicating
// goal/task storage access in Swift outside JS, or a much heavier live
// JS<->Swift bridge — both contradict the brief's "don't reinvent
// resolve.ts". Siri fills this parameter from the tail of the spoken
// phrase's `\(\.$goalName)` slot; the raw words are passed through untouched
// via the deep link to the app's own, already-tested
// `resolveSpokenTarget` / `parse.ts` fuzzy-matching (see
// packages/shared/src/voice/resolve.ts, parse.ts and
// src/components/voice/tracking-commands.ts for the exact logic this reuses
// once the JS side consumes the query param — see notesForCoordinator).
//
// Same foreground hand-off pattern and same "not yet consumed by
// timer.tsx" gap as StartTimerIntent.swift — see that file's header and
// notesForCoordinator for details.

import AppIntents
import UIKit

struct StartTimerForGoalIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Timer For…"
    static var description = IntentDescription(
        "Starts tracking time against a goal or task you name."
    )
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Goal or task name")
    var goalName: String

    static var parameterSummary: some ParameterSummary {
        Summary("Start timer for \(\.$goalName)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        var components = URLComponents(string: "goalslot://timer")
        components?.queryItems = [
            URLQueryItem(name: "autostart", value: "spoken"),
            URLQueryItem(name: "spokenName", value: goalName),
        ]
        guard let url = components?.url else {
            throw StartTimerForGoalIntentError.invalidURL
        }
        await UIApplication.shared.open(url)
        return .result()
    }
}

enum StartTimerForGoalIntentError: Error, CustomLocalizedStringResourceConvertible {
    case invalidURL

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .invalidURL:
            return "Couldn't open GoalSlot to start that timer."
        }
    }
}
