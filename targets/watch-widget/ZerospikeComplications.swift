import SwiftUI
import WidgetKit

// Watch face complications (R10 FAZ 3.3): accessoryCircular (reading only) and
// accessoryRectangular (reading + the active reminder countdown, if any).
// Reads the SAME shared snapshot targets/watch's ContentView reads, written by
// its WCSessionDelegate - this target computes and stores nothing itself.
// "--" with no colour is the honest state for "no data yet".

private enum GlucoseColor {
  static let low = Color(red: 1.0, green: 0.33, blue: 0.41)
  static let target = Color(red: 0.13, green: 0.89, blue: 0.60)
  static let high = Color(red: 1.0, green: 0.824, blue: 0.247)
  static let veryHigh = Color(red: 1.0, green: 0.541, blue: 0.0)
  static let muted = Color(red: 0.54, green: 0.64, blue: 0.69)

  static func forReading(_ mgdl: Double, band: LiveData.Band?) -> Color {
    let hypoMgdl = band?.hypo ?? 70
    let highMgdl = band?.high ?? 180
    let veryHighMgdl = band?.veryHigh ?? 250
    if mgdl < hypoMgdl { return low }
    if mgdl >= veryHighMgdl { return veryHigh }
    if mgdl <= highMgdl { return target }
    return high
  }
}

struct ComplicationEntry: TimelineEntry {
  let date: Date
  let data: LiveData?
}

struct ComplicationProvider: TimelineProvider {
  func placeholder(in context: Context) -> ComplicationEntry {
    ComplicationEntry(date: Date(), data: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
    completion(ComplicationEntry(date: Date(), data: LiveDataStore.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
    let entry = ComplicationEntry(date: Date(), data: LiveDataStore.read())
    // The watch app calls WidgetCenter.reloadAllTimelines() on every incoming
    // applicationContext, so this policy is only a safety net between pushes.
    let nextRefresh = Date().addingTimeInterval(15 * 60)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }
}

struct ZerospikeComplicationsEntryView: View {
  @Environment(\.widgetFamily) private var family
  var entry: ComplicationEntry

  private var readingMgdl: Double? { entry.data?.lastGlucoseMgdl }
  private var reading: String { entry.data?.displayGlucose ?? "--" }
  private var readingColor: Color {
    guard let mgdl = readingMgdl else { return GlucoseColor.muted }
    return GlucoseColor.forReading(mgdl, band: entry.data?.band)
  }

  var body: some View {
    switch family {
    case .accessoryCircular:
      VStack(spacing: 0) {
        Text(reading)
          .font(.system(size: 20, weight: .bold, design: .rounded))
          .foregroundColor(readingColor)
          .minimumScaleFactor(0.5)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 8))
      }
    default:
      HStack(spacing: 4) {
        Text(reading)
          .font(.system(size: 16, weight: .bold, design: .rounded))
          .foregroundColor(readingColor)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 10))
        if let due = entry.data?.nextReminderDate, due > entry.date {
          Spacer(minLength: 2)
          Text(due, style: .timer)
            .font(.system(size: 12, weight: .semibold))
        }
      }
    }
  }
}

@main
struct ZerospikeComplications: Widget {
  let kind = "ZerospikeComplications"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
      ZerospikeComplicationsEntryView(entry: entry)
    }
    .configurationDisplayName("zerospike")
    .description("Last glucose reading and the active reminder countdown.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular])
  }
}
