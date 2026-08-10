import SwiftUI
import WidgetKit

// Watch face complications (R10 FAZ 3.3): accessoryCircular (reading only) and
// accessoryRectangular (reading + the active reminder countdown, if any).
// Reads the SAME shared snapshot targets/watch's ContentView reads, written by
// its WCSessionDelegate - this target computes and stores nothing itself.
// "--" plus the snapshot's localized noData label is the honest state for
// "no data yet"; the gallery preview alone shows a representative sample.

private enum GlucoseColor {
  // Exact sRGB components of the tokens in lib/theme/tokens.ts, same literals as
  // the phone widget's GlucoseColor.
  static let low = Color(red: 1.0, green: 0.3294, blue: 0.4078)        // #ff5468
  static let target = Color(red: 0.1333, green: 0.8902, blue: 0.6039)  // #22e39a
  static let high = Color(red: 1.0, green: 0.8235, blue: 0.2471)       // #ffd23f
  static let wellAbove = Color(red: 1.0, green: 0.6275, blue: 0.1647)  // #ffa02a
  static let veryHigh = Color(red: 1.0, green: 0.5412, blue: 0.0)      // #ff8a00
  static let muted = Color(red: 0.5373, green: 0.6392, blue: 0.6902)   // #89a3b0
  // Same literal as the phone widget's WidgetBackground (#080e14).
  static let background = Color(red: 0.0314, green: 0.0549, blue: 0.0784)

  static func forReading(_ mgdl: Double, band: LiveData.Band?) -> Color {
    let hypoMgdl = band?.hypo ?? 70
    let highMgdl = band?.high ?? 180
    let veryHighMgdl = band?.veryHigh ?? 250
    if mgdl < hypoMgdl { return low }
    if mgdl >= veryHighMgdl { return veryHigh }
    if mgdl <= highMgdl { return target }
    if mgdl <= highMgdl * 1.25 { return high }
    return wellAbove
  }
}

struct ComplicationEntry: TimelineEntry {
  let date: Date
  let data: LiveData?
}

extension LiveData {
  /// Gallery preview / redaction placeholder ONLY: a representative reading so
  /// the complication picker never shows an empty face. Never rendered as the
  /// user's own data; the timeline always reads the real snapshot.
  static let placeholderSample = LiveData(
    updatedAt: 0,
    unit: "mmol",
    lastGlucoseMgdl: 101,
    lastGlucoseDisplay: "5.6",
    lastGlucoseAt: nil,
    avgGlucoseMgdl: 101,
    avgGlucoseDisplay: "5.6",
    avgWindowDays: 7,
    nextReminderAt: nil,
    nextReminderKind: nil,
    band: nil,
    labels: nil
  )
}

struct ComplicationProvider: TimelineProvider {
  func placeholder(in context: Context) -> ComplicationEntry {
    ComplicationEntry(date: Date(), data: LiveDataStore.read() ?? .placeholderSample)
  }

  func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
    // In the picker (isPreview) fall back to the sample so the preview is never
    // blank; on a real face a missing snapshot stays honest ("--" + noData).
    let fallback: LiveData? = context.isPreview ? LiveData.placeholderSample : nil
    completion(ComplicationEntry(date: Date(), data: LiveDataStore.read() ?? fallback))
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

  // With no reading yet, the short localized noData label (from the snapshot)
  // accompanies the "--" instead of a bare unit, so the state reads as "no
  // entries" rather than a broken face.
  private var caption: String {
    if readingMgdl == nil, let noData = entry.data?.labels?.noData {
      return noData
    }
    return entry.data?.unitLabel ?? ""
  }

  var body: some View {
    switch family {
    case .accessoryCircular:
      VStack(spacing: 0) {
        Text(reading)
          .font(.system(size: 20, weight: .bold, design: .rounded))
          .foregroundColor(readingColor)
          .lineLimit(1)
          .minimumScaleFactor(0.5)
        Text(caption)
          .font(.system(size: 8))
          .lineLimit(1)
          .minimumScaleFactor(0.5)
      }
    default:
      HStack(spacing: 4) {
        Text(reading)
          .font(.system(size: 16, weight: .bold, design: .rounded))
          .foregroundColor(readingColor)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        Text(caption)
          .font(.system(size: 10))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        if let due = entry.data?.nextReminderDate, due > entry.date {
          Spacer(minLength: 2)
          Text(due, style: .timer)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
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
      // The brand ground was never set, so the complication rendered on a
      // transparent tile. watchOS 10 wants the containerBackground API; older
      // watchOS gets the plain background fallback.
      if #available(watchOS 10.0, *) {
        ZerospikeComplicationsEntryView(entry: entry)
          .containerBackground(GlucoseColor.background, for: .widget)
      } else {
        ZerospikeComplicationsEntryView(entry: entry)
          .background(GlucoseColor.background)
      }
    }
    // Gallery-only strings, English for every user: the extension bundle carries
    // no localization catalog (see the note on ZerospikeWidget in
    // targets/widget/index.swift). The labels drawn inside the complication ARE
    // localized - they ride in on the app's snapshot.
    .configurationDisplayName("Glucose summary")
    .description("Your glucose average and the time left on your next reminder.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular])
  }
}
