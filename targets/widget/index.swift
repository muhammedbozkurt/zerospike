import SwiftUI
import WidgetKit

// zerospike home-screen widget: the last logged reading and the time left on the
// next reminder, at a glance. Both come from the shared App Group snapshot the
// app writes; the widget computes nothing and interprets nothing.
//
// Colour follows the app's one glucose language, and is never the only signal:
// the value and its unit are always printed beside it.

private enum GlucoseColor {
  static let low = Color(red: 1.0, green: 0.33, blue: 0.41)      // #ff5468
  static let target = Color(red: 0.13, green: 0.89, blue: 0.60)  // #22e39a
  static let high = Color(red: 1.0, green: 0.71, blue: 0.24)     // #ffb43c
  static let veryHigh = Color(red: 0.96, green: 0.32, blue: 0.12) // #f4511e
  static let accent = Color(red: 0.18, green: 0.90, blue: 1.0)   // #2ee6ff
  static let ink = Color(red: 0.92, green: 0.96, blue: 0.98)     // #eaf6fa
  static let muted = Color(red: 0.54, green: 0.64, blue: 0.69)   // #89a3b0

  /// The widget has no profile range, so it uses the population defaults plus
  /// the app's fixed clinical ceiling. It is a glance, not a classification.
  static func forReading(_ mgdl: Double) -> Color {
    if mgdl < 70 { return low }
    if mgdl >= 250 { return veryHigh }
    if mgdl <= 180 { return target }
    return high
  }
}

struct ZerospikeEntry: TimelineEntry {
  let date: Date
  let data: LiveData?
}

struct ZerospikeProvider: TimelineProvider {
  func placeholder(in context: Context) -> ZerospikeEntry {
    ZerospikeEntry(date: Date(), data: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (ZerospikeEntry) -> Void) {
    completion(ZerospikeEntry(date: Date(), data: LiveDataStore.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ZerospikeEntry>) -> Void) {
    let now = Date()
    let data = LiveDataStore.read()
    // Minute precision is enough for a countdown, and refreshing every minute
    // for an hour keeps the widget honest without burning the refresh budget.
    var entries: [ZerospikeEntry] = []
    for minute in 0..<60 {
      let date = Calendar.current.date(byAdding: .minute, value: minute, to: now) ?? now
      entries.append(ZerospikeEntry(date: date, data: data))
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

struct ZerospikeWidgetView: View {
  var entry: ZerospikeEntry

  private var reading: String {
    entry.data?.displayGlucose ?? "-"
  }

  private var readingColor: Color {
    guard let mgdl = entry.data?.lastGlucoseMgdl else { return GlucoseColor.muted }
    return GlucoseColor.forReading(mgdl)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(entry.data?.labels?.lastReading ?? "")
        .font(.system(size: 10, weight: .bold))
        .foregroundColor(GlucoseColor.muted)

      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundColor(readingColor)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11))
          .foregroundColor(GlucoseColor.muted)
      }

      if entry.data?.lastGlucoseMgdl == nil {
        Text(entry.data?.labels?.noData ?? "")
          .font(.system(size: 11))
          .foregroundColor(GlucoseColor.muted)
      }

      Spacer(minLength: 0)

      if let due = entry.data?.nextReminderDate, due > entry.date {
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.data?.labels?.nextReminder ?? "")
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(GlucoseColor.muted)
          Text(due, style: .timer)
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(GlucoseColor.accent)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(14)
  }
}

@main
struct ZerospikeWidgetBundle: WidgetBundle {
  var body: some Widget {
    ZerospikeWidget()
    if #available(iOS 16.2, *) {
      PostMealActivityWidget()
    }
  }
}

struct ZerospikeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeWidget", provider: ZerospikeProvider()) { entry in
      if #available(iOS 17.0, *) {
        ZerospikeWidgetView(entry: entry)
          .containerBackground(for: .widget) { Color("WidgetBackground") }
      } else {
        ZerospikeWidgetView(entry: entry)
          .background(Color("WidgetBackground"))
      }
    }
    .configurationDisplayName("zerospike")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
