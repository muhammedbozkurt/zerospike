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
  static let high = Color(red: 1.0, green: 0.824, blue: 0.247)   // #ffd23f (E1: yellow)
  static let veryHigh = Color(red: 1.0, green: 0.541, blue: 0.0) // #ff8a00 (E1: deep orange)
  static let accent = Color(red: 0.18, green: 0.90, blue: 1.0)   // #2ee6ff
  static let ink = Color(red: 0.92, green: 0.96, blue: 0.98)     // #eaf6fa
  static let muted = Color(red: 0.54, green: 0.64, blue: 0.69)   // #89a3b0

  /// Colours a reading against the PROFILE's own band (mg/dL) when the snapshot
  /// carries one, falling back to the population defaults + the fixed clinical
  /// ceiling for older snapshots. It is a glance, not a classification.
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
  @Environment(\.widgetFamily) private var family
  var entry: ZerospikeEntry

  // The widget pins the rolling AVERAGE (a persistent number), falling back to the
  // last reading only for a pre-R10 snapshot that carries no average yet.
  private var reading: String {
    entry.data?.displayAverage ?? entry.data?.displayGlucose ?? "-"
  }

  private var readingMgdl: Double? {
    entry.data?.avgGlucoseMgdl ?? entry.data?.lastGlucoseMgdl
  }

  private var readingLabel: String {
    entry.data?.labels?.avgGlucose ?? entry.data?.labels?.lastReading ?? ""
  }

  private var readingColor: Color {
    guard let mgdl = readingMgdl else { return GlucoseColor.muted }
    return GlucoseColor.forReading(mgdl, band: entry.data?.band)
  }

  var body: some View {
    switch family {
    case .accessoryInline:
      // Lock-screen inline: one short line the OS tints for us.
      inlineView
    case .accessoryRectangular:
      // Lock-screen rectangular: last reading + time to next reminder.
      rectangularView
    default:
      standardView
    }
  }

  /// Home-screen small / medium: the full glance.
  private var standardView: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(readingLabel)
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

      if readingMgdl == nil {
        Text(entry.data?.labels?.noData ?? "")
          .font(.system(size: 11))
          .foregroundColor(GlucoseColor.muted)
      } else if let window = entry.data?.labels?.avgWindow {
        Text(window)
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

  /// Lock-screen rectangular accessory: last reading (+ unit) and the countdown
  /// to the next reminder. Rendered in the tint the OS provides.
  private var rectangularView: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(reading)
          .font(.system(size: 20, weight: .bold, design: .rounded))
          .monospacedDigit()
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11))
      }
      if let due = entry.data?.nextReminderDate, due > entry.date {
        HStack(spacing: 3) {
          Image(systemName: "timer")
            .font(.system(size: 10))
          Text(due, style: .timer)
            .font(.system(size: 12, weight: .semibold))
            .monospacedDigit()
        }
      } else {
        Text(readingLabel)
          .font(.system(size: 11))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  /// Lock-screen inline accessory: a single short string (OS-constrained to one
  /// line + an optional glyph), so just the last reading and its unit.
  private var inlineView: some View {
    Text("\(reading) \(entry.data?.unitLabel ?? "")")
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
    // Home-screen + lock-screen (iOS 16+ accessory) families. The deployment
    // target is 16.4, so the accessory cases are always available here.
    .supportedFamilies([
      .systemSmall,
      .systemMedium,
      .accessoryRectangular,
      .accessoryInline,
    ])
  }
}
