// "Talk about my day" — the third App Shortcut / Siri phrase for GoalSlot's
// voice-trigger feature (see AppShortcuts.swift for the AppShortcutsProvider
// that registers the spoken phrase for this intent).
//
// Spoken as "Hey Siri, talk about my day in GoalSlot" (or a user-recorded
// custom phrase). This intent does NOT do any speech-to-text itself — it
// simply hands off to the already-running app, exactly like StartTimerIntent
// and StartTimerForGoalIntent do (see those files for the shared rationale):
// `openAppWhenRun = true` forces GoalSlot to the foreground, then
// `UIApplication.shared.open(url)` round-trips through the same
// `RCTLinkingManager` path `AppDelegate.swift`'s `application(_:open:options:)`
// already wires up for every other `goalslot://` deep link (widget taps,
// notification taps, etc.) — no new native module needed.
//
// The `goalslot://journal?voice=1` shape matches
// `journalVoiceCaptureDeepLink()` in `apps/mobile/src/lib/deep-links.ts`,
// which mirrors the existing `timerAutoStart` `?autostart=1&goalId=...`
// idiom. journal.tsx reads the `voice` param (via `useLocalSearchParams`,
// the same pattern timer.tsx already uses for `autostart`) to open today's
// entry and start live speech capture — see that screen for the full
// priming/listening/blocked/soft-stopped state machine this deep link feeds
// into.
import AppIntents
import UIKit

struct TalkAboutMyDayIntent: AppIntent {
    static var title: LocalizedStringResource = "Talk About My Day"
    static var description = IntentDescription(
        "Opens today's journal entry in GoalSlot and starts listening so you can speak about your day."
    )
    // Forces GoalSlot to the foreground before `perform()` runs, so
    // `UIApplication.shared.open(url)` below is guaranteed to be handled by
    // a live RCTLinkingManager rather than racing app launch.
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "goalslot://journal?voice=1") else {
            throw TalkAboutMyDayIntentError.invalidURL
        }
        await UIApplication.shared.open(url)
        return .result()
    }
}

enum TalkAboutMyDayIntentError: Error, CustomLocalizedStringResourceConvertible {
    case invalidURL

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .invalidURL:
            return "GoalSlot couldn't open the journal."
        }
    }
}
