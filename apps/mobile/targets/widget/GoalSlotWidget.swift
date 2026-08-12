import WidgetKit
import SwiftUI

// Mirrors TodayWidget.tsx's states/kinds one-for-one (block/progress/
// empty-day/unavailable) so the iOS widget reads as the same feature as
// Android's, not a reimplementation with its own drift. The JSON this
// decodes is written by src/widgets/ios-widget-sync.ts via widget-bridge
// into the shared App Group container — see WidgetBridgeModule.swift for
// the write side.
struct WidgetState: Codable {
  let kind: String
  let status: String?
  let title: String?
  let timeRange: String?
  let color: String?
  let done: Int?
  let total: Int?
  /// Present only when the current/next block is linked to a goal — see widget-data.ts's `WidgetBlockSummary.goalId`. Drives the "Start" button below; blocks with no linked goal fall back to the whole-widget open-app tap target only.
  let goalId: String?
  /// Today's overall done/total, present alongside a "block" `kind` — bonus content shown only on `.systemLarge` (see `body(for:)`), so a resize-free small/medium widget isn't cluttered. Mirrors TodayWidget.tsx's `dayProgress`/`hasRoomForExtras` on Android, gated by `family` here instead of a height threshold since iOS has no free resize.
  let dayDone: Int?
  let dayTotal: Int?
  /// "running" | "paused" | nil — independent of `kind`/`status` above, which describe the *schedule*, not whether a timer is actually going. See widget-data.ts's `loadWidgetTrackingState`.
  let trackingStatus: String?
  /// The task's title when tracking a task, else the goal's — "show the task itself, not the goal" per the product ask.
  let trackingPrimaryLabel: String?
  /// The parent goal's title, present only when `trackingPrimaryLabel` is a task title and that task has a linked goal.
  let trackingSecondaryLabel: String?
  let trackingElapsedLabel: String?
  /// 0–1 "timer bar" fill — see widget-data.ts's `WidgetTrackingState.progress` for why this isn't a completion percentage and isn't live-ticking.
  let trackingProgress: Double?
}

private let fallbackState = WidgetState(
  kind: "unavailable", status: nil, title: nil, timeRange: nil, color: nil, done: nil, total: nil, goalId: nil,
  dayDone: nil, dayTotal: nil, trackingStatus: nil, trackingPrimaryLabel: nil, trackingSecondaryLabel: nil,
  trackingElapsedLabel: nil, trackingProgress: nil
)

let appGroupId = "group.io.goalslot.mobile"
let widgetStateKey = "widget_state"

struct TodayEntry: TimelineEntry {
  let date: Date
  let state: WidgetState
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), state: fallbackState)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    completion(readEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    // The app itself calls WidgetCenter.reloadAllTimelines() on every
    // foreground (see ios-widget-sync.ts) — this 30-minute fallback just
    // covers the gap between app opens, not the primary refresh path.
    let timeline = Timeline(entries: [readEntry()], policy: .after(Date().addingTimeInterval(30 * 60)))
    completion(timeline)
  }

  private func readEntry() -> TodayEntry {
    guard
      let json = UserDefaults(suiteName: appGroupId)?.string(forKey: widgetStateKey),
      let data = json.data(using: .utf8),
      let state = try? JSONDecoder().decode(WidgetState.self, from: data)
    else {
      return TodayEntry(date: Date(), state: fallbackState)
    }
    return TodayEntry(date: Date(), state: state)
  }
}

// Brand yellow, matching app.json's primaryColor / TodayWidget.tsx's accent use.
let brandColor = Color(red: 0.949, green: 0.800, blue: 0.051)

struct GoalSlotWidgetEntryView: View {
  var entry: Provider.Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let isTracking = entry.state.trackingStatus != nil
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 4) {
        Circle().fill(brandColor).frame(width: 6, height: 6)
        Text("TODAY")
          .font(.system(size: 11, weight: .semibold))
          .tracking(0.5)
          .foregroundColor(.secondary)
      }
      Spacer(minLength: 4)
      // Anchored under the header, not centered in the full card — with
      // `.systemLarge` now supported, centering left a dead gap ABOVE the
      // content (same bug this fixed on Android's freely-resizable
      // widget). Any leftover height collects below instead.
      body(for: entry.state)
      if isTracking {
        Spacer(minLength: 4)
        TrackingBand(state: entry.state)
      } else {
        Spacer(minLength: 0)
      }
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    // Tapping the widget while a session is running goes to the Timer tab
    // (there's something live to look at); otherwise it goes to Today —
    // same reasoning as TodayWidget.tsx's Android counterpart.
    .widgetURL(URL(string: isTracking ? "goalslot://timer" : "goalslot://"))
    .containerBackground(for: .widget) { Color(.secondarySystemBackground) }
  }

  @ViewBuilder
  private func body(for state: WidgetState) -> some View {
    switch state.kind {
    case "block":
      let isActive = state.status == "active"
      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Circle()
                .fill(Color(hex: state.color) ?? brandColor)
                .frame(width: 10, height: 10)
              Text(isActive ? "NOW" : "NEXT")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.5)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(isActive ? brandColor : Color(.tertiarySystemFill))
                .foregroundColor(isActive ? .black : .secondary)
                .clipShape(Capsule())
            }
            Text(state.title ?? "")
              .font(.system(size: 16, weight: .bold))
              .lineLimit(1)
            Text(state.timeRange ?? "")
              .font(.system(size: 13))
              .foregroundColor(.secondary)
          }
          // Its own tap target (a WidgetKit `Link`, not the containing
          // view's `.widgetURL`) so tapping it starts tracking directly
          // instead of just opening the app to the Today tab like the rest
          // of the widget does. Only worth the layout room on
          // medium/large (small has no room for a second tap target),
          // only makes sense when the block actually has a goal to track
          // against (widget-data.ts's `WidgetBlockSummary.goalId`), and
          // hidden entirely once something's already running — tapping it
          // again would restart the running session (see timer.tsx's
          // `autostart` guard), and the tracking band below already
          // covers that case.
          if family != .systemSmall, state.trackingStatus == nil, let goalId = state.goalId, !goalId.isEmpty,
            let encodedGoalId = goalId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
            let url = URL(string: "goalslot://timer?autostart=1&goalId=\(encodedGoalId)")
          {
            Spacer()
            Link(destination: url) {
              Text("Start")
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(brandColor)
                .foregroundColor(.black)
                .clipShape(Capsule())
            }
          }
        }
        // Bonus content filling the extra room `.systemLarge` has over
        // medium — see `WidgetState.dayDone`/`.dayTotal`'s doc comment.
        if family == .systemLarge, let dayDone = state.dayDone, let dayTotal = state.dayTotal {
          VStack(alignment: .leading, spacing: 4) {
            Divider()
            Text("TODAY'S PROGRESS")
              .font(.system(size: 10, weight: .semibold))
              .tracking(0.5)
              .foregroundColor(.secondary)
            Text(
              dayDone >= dayTotal && dayTotal > 0
                ? "All \(dayTotal) blocks done — nice work"
                : "\(dayDone) of \(dayTotal) blocks done so far"
            )
            .font(.system(size: 13, weight: .semibold))
          }
          .padding(.top, 4)
        }
      }
    case "progress":
      let done = state.done ?? 0
      let total = state.total ?? 0
      VStack(alignment: .leading, spacing: 4) {
        Text("\(done) of \(total)")
          .font(.system(size: 26, weight: .bold))
        Text(done >= total && total > 0 ? "blocks done — nice work" : "blocks done today")
          .font(.system(size: 13))
          .foregroundColor(.secondary)
      }
    case "empty-day":
      VStack(alignment: .leading, spacing: 4) {
        Text("Nothing scheduled").font(.system(size: 16, weight: .bold))
        Text("Your day is wide open.").font(.system(size: 13)).foregroundColor(.secondary)
      }
    default:
      VStack(alignment: .leading, spacing: 4) {
        Text("Open GoalSlot").font(.system(size: 16, weight: .bold))
        Text("Tap to view your day.").font(.system(size: 13)).foregroundColor(.secondary)
      }
    }
  }
}

/// A persistent status band for "what's being tracked right now" — shown regardless of what the schedule body above is displaying, since the two can disagree (e.g. tracking a goal that isn't even one of today's scheduled blocks). Mirrors TodayWidget.tsx's `TrackingBand` on Android field-for-field, including the non-live "timer bar".
private struct TrackingBand: View {
  let state: WidgetState

  var body: some View {
    let isPaused = state.trackingStatus == "paused"
    VStack(alignment: .leading, spacing: 4) {
      Divider()
      HStack(spacing: 6) {
        Circle()
          .fill(isPaused ? Color.secondary : brandColor)
          .frame(width: 6, height: 6)
        Text(isPaused ? "Paused" : "Tracking")
          .font(.system(size: 10, weight: .semibold))
          .tracking(0.3)
          .foregroundColor(.secondary)
        Spacer()
        Text(state.trackingElapsedLabel ?? "")
          .font(.system(size: 10, weight: .bold))
      }
      .padding(.top, 6)
      Text(state.trackingPrimaryLabel ?? "")
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(1)
      if let secondary = state.trackingSecondaryLabel {
        Text(secondary)
          .font(.system(size: 11))
          .foregroundColor(.secondary)
          .lineLimit(1)
      }
      ProgressView(value: state.trackingProgress ?? 0)
        .tint(isPaused ? Color.secondary : brandColor)
    }
  }
}

struct GoalSlotWidget: Widget {
  let kind: String = "GoalSlotWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      GoalSlotWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("GoalSlot — Today")
    .description("Your next scheduled block, or today's progress. Tap to open the app.")
    // iOS has no free-drag resize the way Android does — the closest
    // equivalent of "adjustable size" is offering more fixed sizes to pick
    // between in the widget gallery/edit sheet. Large gets the same
    // top-anchored layout as the others (see body's `Spacer` placement
    // above); it just ends up with more breathing room below the content
    // rather than a different layout.
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct GoalSlotWidgetBundle: WidgetBundle {
  var body: some Widget {
    GoalSlotWidget()
  }
}

extension Color {
  /// Parses `#RRGGBB` — same validated shape TodayWidget.tsx's `toHexColor` expects from the API, so this only ever sees well-formed hex or nil.
  init?(hex: String?) {
    guard let hex, hex.hasPrefix("#"), hex.count == 7 else { return nil }
    let scanner = Scanner(string: String(hex.dropFirst()))
    var rgb: UInt64 = 0
    guard scanner.scanHexInt64(&rgb) else { return nil }
    self.init(
      red: Double((rgb & 0xFF0000) >> 16) / 255,
      green: Double((rgb & 0x00FF00) >> 8) / 255,
      blue: Double(rgb & 0x0000FF) / 255
    )
  }
}
