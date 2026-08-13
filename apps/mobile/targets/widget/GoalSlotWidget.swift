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
  /// Today's overall done/total, present alongside a "block" `kind`. Shown as a compact `4/8` readout opposite "TODAY" in the header on small/medium (mirroring TodayWidget.tsx's header progress on Android, which made progress visible at *every* size rather than only a tall one), and promoted to a full pip-row section on `.systemLarge`, which has the room for it.
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

// ---------------------------------------------------------------------------
// LAYOUT INTENT
//
// Three families, three deliberate compositions — not one layout stretched or
// cropped. What they share (so it stays *one* feature, and the same feature as
// Android's TodayWidget.tsx): an eyebrow header with the day's progress
// opposite it, and a block panel whose leading edge is a bar in the block's
// own colour.
//
//   .systemSmall   one column; no time range and no Start button (there is no
//                  room for a second tap target), tracking collapses to a
//                  label + elapsed + bar strip.
//   .systemMedium  two columns when a session is running. Medium is a ~2:1
//                  card, so stacking the tracking band *under* the block both
//                  wasted the empty right half and overflowed the card's
//                  height — the progress bar ended up flush against the
//                  bottom edge. Side-by-side fixes both at once.
//   .systemLarge   one column, but with real sections rather than one small
//                  layout floating in a tall card: the block panel stretches
//                  (it is a filled surface, so height reads as deliberate),
//                  then a day-progress section with one pip per block, then
//                  the tracking panel.
//
// SPACING: `.contentMarginsDisabled()` on the configuration below turns off
// WidgetKit's automatic content margins so padding is decided in exactly one
// place — `outerPadding` here — instead of being the sum of a system margin
// and a local `.padding()`. Every edge inset in this file is measured from
// the card's real edge.
// ---------------------------------------------------------------------------

struct GoalSlotWidgetEntryView: View {
  var entry: Provider.Entry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  private var state: WidgetState { entry.state }
  private var isTracking: Bool { state.trackingStatus != nil }
  private var isSmall: Bool { family == .systemSmall }
  private var isLarge: Bool { family == .systemLarge }

  /// The block's own colour drives the accent bar and the panel tint. Non-block states have no colour of their own and fall back to a neutral, so the panel doesn't imply a category that isn't there.
  private var accent: Color {
    switch state.kind {
    case "block": return Color(hex: state.color) ?? brandColor
    case "progress": return brandColor
    default: return Color(.tertiaryLabel)
    }
  }

  private var outerPadding: CGFloat { isSmall ? 14 : 17 }

  var body: some View {
    VStack(alignment: .leading, spacing: isSmall ? 9 : 12) {
      header
      content
    }
    .padding(outerPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // Tapping the widget while a session is running goes to the Timer tab
    // (there's something live to look at); otherwise it goes to Today —
    // same reasoning as TodayWidget.tsx's Android counterpart.
    .widgetURL(URL(string: isTracking ? "goalslot://timer" : "goalslot://"))
    .containerBackground(for: .widget) {
      LinearGradient(
        colors: [Color(.systemBackground), Color(.secondarySystemBackground)],
        startPoint: .top,
        endPoint: .bottom
      )
    }
  }

  // MARK: - Header

  /// The eyebrow doubles as the day's progress readout — `4/8` sits opposite
  /// "TODAY" rather than in a band of its own, which is what lets a wide card
  /// use its horizontal space instead of growing another row. Suppressed on
  /// large, where the dedicated progress section below says it properly, and
  /// on the "progress" kind, where done/total is already the hero.
  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Circle()
        .fill(brandColor)
        .frame(width: 6, height: 6)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
      Text("TODAY")
        .font(.system(size: isSmall ? 10 : 11, weight: .bold, design: .rounded))
        .tracking(1.1)
        .foregroundStyle(.secondary)
      Spacer(minLength: 6)
      if let label = headerProgressLabel {
        Text(label)
          .font(.system(size: isSmall ? 10 : 11, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
    }
  }

  private var headerProgressLabel: String? {
    guard !isLarge, state.kind == "block", let done = state.dayDone, let total = state.dayTotal, total > 0 else {
      return nil
    }
    return isSmall ? "\(done)/\(total)" : "\(done)/\(total) done"
  }

  // MARK: - Per-family composition

  @ViewBuilder
  private var content: some View {
    switch family {
    case .systemSmall:
      VStack(alignment: .leading, spacing: 9) {
        panel
        if isTracking { TrackingStrip(state: state) }
      }
    case .systemLarge:
      VStack(alignment: .leading, spacing: 13) {
        panel
        if state.kind == "block", let done = state.dayDone, let total = state.dayTotal, total > 0 {
          DayProgressSection(done: done, total: total)
        }
        if isTracking { TrackingPanel(state: state) }
      }
    default:
      // Side-by-side only while something is running; otherwise the panel
      // takes the full width and carries the Start button on its trailing
      // edge, so a wide card never has an empty half.
      if isTracking {
        HStack(alignment: .top, spacing: 11) {
          panel
          // Fixed rather than proportional: the block title and time range on
          // the left need every point they can get before `minimumScaleFactor`
          // starts shrinking them, and this column's content is a known width.
          TrackingColumn(state: state).frame(width: 116)
        }
      } else {
        panel
      }
    }
  }

  // MARK: - The block panel

  private var panel: some View {
    AccentPanel(accent: accent, scheme: scheme, compact: isSmall) {
      switch state.kind {
      case "block":
        blockContent
      case "progress":
        let done = state.done ?? 0
        let total = state.total ?? 0
        ProgressContent(done: done, total: total, compact: isSmall, showBar: !isSmall)
      case "empty-day":
        MessageContent(
          headline: "Nothing scheduled", detail: "Your day is wide open.", size: titleSize, compact: isSmall)
      default:
        MessageContent(
          headline: "Open GoalSlot", detail: "Tap to view your day.", size: titleSize, compact: isSmall)
      }
    }
  }

  private var titleSize: CGFloat {
    switch family {
    case .systemSmall: return 17
    case .systemLarge: return 26
    default: return 21
    }
  }

  @ViewBuilder
  private var blockContent: some View {
    let isActive = state.status == "active"
    HStack(alignment: .center, spacing: 10) {
      VStack(alignment: .leading, spacing: isSmall ? 5 : 7) {
        StatusChip(isActive: isActive, compact: isSmall)
        Text(state.title ?? "")
          .font(.system(size: titleSize, weight: .bold))
          // A two-line title only fits on small when the tracking strip
          // isn't also claiming the bottom of the card.
          .lineLimit(isSmall ? (isTracking ? 1 : 2) : 1)
          .minimumScaleFactor(0.72)
          .foregroundStyle(.primary)
        // The time range is the first thing to go when room is short: the
        // title and the NOW/NEXT chip alone still answer "what's on right
        // now", which is what a one-glance widget owes you.
        if !isSmall, let range = state.timeRange, !range.isEmpty {
          Label {
            Text(range)
              .font(.system(size: isLarge ? 14 : 12.5, weight: .medium))
              .monospacedDigit()
          } icon: {
            Image(systemName: "clock").font(.system(size: isLarge ? 12 : 10.5, weight: .semibold))
          }
          .labelStyle(.inlineCompact)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        }
      }
      // Its own tap target (a WidgetKit `Link`, not the containing view's
      // `.widgetURL`) so tapping it starts tracking directly instead of just
      // opening the app to the Today tab like the rest of the widget does.
      // Only worth the layout room on medium/large (small has no room for a
      // second tap target), only makes sense when the block actually has a
      // goal to track against (widget-data.ts's `WidgetBlockSummary.goalId`),
      // and hidden entirely once something's already running — tapping it
      // again would restart the running session (see timer.tsx's `autostart`
      // guard), and the tracking panel already covers that case.
      if !isSmall, state.trackingStatus == nil, let goalId = state.goalId, !goalId.isEmpty,
        let encodedGoalId = goalId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
        let url = URL(string: "goalslot://timer?autostart=1&goalId=\(encodedGoalId)")
      {
        Spacer(minLength: 8)
        Link(destination: url) { StartButton() }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Shared pieces

/// The block panel: a tinted surface with a bar in the block's colour down its
/// leading edge. The bar stretches to the panel's full inner height and the
/// panel stretches to fill leftover card height, so extra room on `.systemLarge`
/// lands inside a filled surface instead of pooling as blank card — the same
/// "let one element absorb the slack" rule TodayWidget.tsx follows on Android,
/// solved with a filled panel here because iOS's fixed families make the
/// leftover amount predictable.
private struct AccentPanel<Content: View>: View {
  let accent: Color
  let scheme: ColorScheme
  let compact: Bool
  @ViewBuilder var content: () -> Content

  var body: some View {
    HStack(spacing: compact ? 10 : 12) {
      // Only a shallow fade: the panel behind it is tinted with this same
      // hue, so a bar that drops much below full opacity stops reading as an
      // edge at all.
      Capsule()
        .fill(
          LinearGradient(
            colors: [accent, accent.opacity(0.72)], startPoint: .top, endPoint: .bottom)
        )
        .frame(width: 5)
        .frame(maxHeight: .infinity)
      content()
    }
    .padding(.vertical, compact ? 10 : 13)
    .padding(.leading, compact ? 10 : 12)
    .padding(.trailing, compact ? 11 : 14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: compact ? 14 : 17, style: .continuous)
        // Tinting with the block's own colour rather than a flat grey is what
        // makes the category legible at a glance. Dark home screens need more
        // of it to register against `.secondarySystemBackground`.
        .fill(accent.opacity(scheme == .dark ? 0.20 : 0.11))
    )
  }
}

/// "NOW" keeps the brand yellow that means *happening right now* everywhere
/// else in the app (TimelineBlock.tsx's `NowBadge`); "NEXT" stays neutral so
/// the yellow doesn't get diluted into meaning "a block".
private struct StatusChip: View {
  let isActive: Bool
  let compact: Bool

  var body: some View {
    Text(isActive ? "NOW" : "NEXT")
      .font(.system(size: compact ? 9 : 10, weight: .heavy, design: .rounded))
      .tracking(0.8)
      .foregroundStyle(isActive ? Color.black : Color.secondary)
      .padding(.horizontal, compact ? 7 : 8)
      .padding(.vertical, compact ? 3 : 3.5)
      .background(
        Capsule().fill(
          isActive
            ? AnyShapeStyle(
              LinearGradient(
                colors: [brandColor, brandColor.opacity(0.82)],
                startPoint: .topLeading, endPoint: .bottomTrailing))
            : AnyShapeStyle(Color.primary.opacity(0.10)))
      )
  }
}

private struct StartButton: View {
  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "play.fill").font(.system(size: 10, weight: .black))
      Text("Start").font(.system(size: 13, weight: .semibold, design: .rounded))
    }
    .foregroundStyle(Color.black)
    .padding(.horizontal, 13)
    .padding(.vertical, 8)
    .background(
      Capsule().fill(
        LinearGradient(
          colors: [brandColor, brandColor.opacity(0.85)],
          startPoint: .top, endPoint: .bottom))
    )
  }
}

private struct MessageContent: View {
  let headline: String
  let detail: String
  let size: CGFloat
  let compact: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 3 : 5) {
      Text(headline)
        .font(.system(size: size, weight: .bold))
        .lineLimit(2)
        .minimumScaleFactor(0.72)
      Text(detail)
        .font(.system(size: compact ? 12 : 13, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The "nothing left today" state. done/total is the headline number here, so
/// it gets the numeric treatment (rounded, monospaced digits) rather than
/// being buried in a sentence.
private struct ProgressContent: View {
  let done: Int
  let total: Int
  let compact: Bool
  let showBar: Bool

  private var isComplete: Bool { done >= total && total > 0 }

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 4 : 7) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text("\(done)")
          .font(.system(size: compact ? 26 : 32, weight: .bold, design: .rounded))
          .monospacedDigit()
        Text("/ \(total)")
          .font(.system(size: compact ? 15 : 18, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
      Text(isComplete ? "blocks done — nice work" : "blocks done today")
        .font(.system(size: compact ? 12 : 13, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if showBar {
        MiniProgressBar(value: total > 0 ? Double(done) / Double(total) : 0, tint: brandColor, height: 6)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One pip per scheduled block, filled as they're completed — the day's shape
/// at a glance, which is what `.systemLarge` has the width to actually show.
/// Falls back to a plain bar past a dozen blocks, where pips become slivers.
private struct DayProgressSection: View {
  let done: Int
  let total: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text("TODAY'S PROGRESS")
          .font(.system(size: 10, weight: .bold, design: .rounded))
          .tracking(0.9)
          .foregroundStyle(.secondary)
        Spacer(minLength: 6)
        Text(
          done >= total
            ? "all done" : "\(total - done) to go"
        )
        .font(.system(size: 11, weight: .semibold, design: .rounded))
        .foregroundStyle(.tertiary)
      }
      if total <= 12 {
        HStack(spacing: 4) {
          ForEach(0..<total, id: \.self) { index in
            Capsule()
              .fill(
                index < done
                  ? AnyShapeStyle(
                    LinearGradient(
                      colors: [brandColor, brandColor.opacity(0.78)],
                      startPoint: .top, endPoint: .bottom))
                  : AnyShapeStyle(Color.primary.opacity(0.11)))
              .frame(maxWidth: .infinity)
          }
        }
        .frame(height: 8)
      } else {
        MiniProgressBar(value: Double(done) / Double(total), tint: brandColor, height: 8)
      }
      // Deliberately no "4 of 8 blocks done so far" line under this. The pips
      // already *are* the count, and a sentence restating them directly below
      // the trailing "4 to go" said the same thing three ways in a row.
    }
  }
}

// MARK: - Tracking

/// Shared vocabulary for the three tracking treatments below, so a paused
/// session desaturates identically at every size.
private struct TrackingLook {
  let isPaused: Bool
  let tint: Color
  let label: String
  let elapsed: String

  init(state: WidgetState) {
    isPaused = state.trackingStatus == "paused"
    tint = isPaused ? Color.secondary : brandColor
    label = isPaused ? "PAUSED" : "TRACKING"
    elapsed = state.trackingElapsedLabel ?? ""
  }
}

/// `.systemSmall`: one strip — status, elapsed, bar. The session's title is
/// dropped rather than squeezed; on a small card the scheduled block above is
/// already carrying the "what" and this only has to say "and a timer is going".
private struct TrackingStrip: View {
  let state: WidgetState

  var body: some View {
    let look = TrackingLook(state: state)
    VStack(alignment: .leading, spacing: 5) {
      HStack(spacing: 5) {
        Circle().fill(look.tint).frame(width: 5, height: 5)
        Text(look.label)
          .font(.system(size: 9, weight: .bold, design: .rounded))
          .tracking(0.7)
          .foregroundStyle(.secondary)
        Spacer(minLength: 4)
        Text(look.elapsed)
          .font(.system(size: 11, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(.primary)
      }
      MiniProgressBar(value: state.trackingProgress ?? 0, tint: look.tint, height: 4)
    }
  }
}

/// `.systemMedium`: the right-hand column, in a neutral panel that matches the
/// block panel's shape and corner radius. Giving it a container is what makes
/// the two-column split read as a deliberate composition rather than as text
/// stranded beside a card — and since both panels stretch, it also guarantees
/// the two columns share an exact top and bottom edge.
///
/// Elapsed time is this panel's headline: it's the one value that changes
/// minute to minute, so it gets the monospaced digits that stop it jittering
/// as it ticks. It stays a step *below* the block title's size, though — the
/// widget's own header says "TODAY", so the scheduled block stays the hero and
/// this is the supporting readout.
private struct TrackingColumn: View {
  let state: WidgetState

  var body: some View {
    let look = TrackingLook(state: state)
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 5) {
        Circle().fill(look.tint).frame(width: 5, height: 5)
        Text(look.label)
          .font(.system(size: 9, weight: .bold, design: .rounded))
          .tracking(0.7)
          .foregroundStyle(.secondary)
      }
      .padding(.bottom, 7)
      Text(look.elapsed)
        .font(.system(size: 19, weight: .bold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Text(state.trackingPrimaryLabel ?? "")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      // One spacer, not two: the label/elapsed/title group anchors to the top
      // and the bar to the bottom, so the slack collects in a single
      // predictable place instead of floating the group in the middle.
      Spacer(minLength: 10)
      MiniProgressBar(value: state.trackingProgress ?? 0, tint: look.tint, height: 5)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 13)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(
      RoundedRectangle(cornerRadius: 17, style: .continuous).fill(Color(.tertiarySystemFill))
    )
  }
}

/// `.systemLarge`: a full-width panel. Task wins over its parent goal as the
/// headline (`trackingPrimaryLabel`), with the goal as a subtitle when there
/// is one — see widget-data.ts's `loadWidgetTrackingState`.
private struct TrackingPanel: View {
  let state: WidgetState

  var body: some View {
    let look = TrackingLook(state: state)
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 6) {
        Circle().fill(look.tint).frame(width: 6, height: 6)
        Text(look.label)
          .font(.system(size: 10, weight: .bold, design: .rounded))
          .tracking(0.9)
          .foregroundStyle(.secondary)
        Spacer(minLength: 8)
        Text(look.elapsed)
          .font(.system(size: 17, weight: .bold, design: .rounded))
          .monospacedDigit()
      }
      Text(state.trackingPrimaryLabel ?? "")
        .font(.system(size: 15, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if let secondary = state.trackingSecondaryLabel, !secondary.isEmpty {
        Text(secondary)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.85)
      }
      MiniProgressBar(value: state.trackingProgress ?? 0, tint: look.tint, height: 6)
        .padding(.top, 1)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 13)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(.tertiarySystemFill))
    )
  }
}

/// A capsule track with a capsule fill, rather than `ProgressView` — the stock
/// bar draws its own inset and hairline track, which reads as a form control
/// next to these panels instead of as a readout, and it can't take a gradient.
private struct MiniProgressBar: View {
  let value: Double
  let tint: Color
  var height: CGFloat = 6

  var body: some View {
    let filled = min(max(value, 0), 1)
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.primary.opacity(0.12))
        Capsule()
          .fill(
            LinearGradient(
              colors: [tint.opacity(0.7), tint], startPoint: .leading, endPoint: .trailing)
          )
          // Never narrower than it is tall, so a session that just started
          // still shows a dot of colour rather than nothing at all.
          .frame(width: max(height, geo.size.width * filled))
      }
    }
    .frame(height: height)
  }
}

/// `.titleAndIcon` puts a full label-column gap between glyph and text, which
/// is too much for a 10pt clock next to a time range.
private struct InlineCompactLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon
      configuration.title
    }
  }
}

extension LabelStyle where Self == InlineCompactLabelStyle {
  static var inlineCompact: InlineCompactLabelStyle { InlineCompactLabelStyle() }
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
    // between in the widget gallery/edit sheet. Each family gets its own
    // composition rather than a stretch of the others; see LAYOUT INTENT.
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    // See LAYOUT INTENT: all edge insets come from `outerPadding` alone, so
    // the padding you read in this file is the padding you get on screen.
    .contentMarginsDisabled()
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
