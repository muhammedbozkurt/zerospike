import SwiftUI
import WidgetKit

// zerospike home-screen widget: the last logged reading and the time left on the
// next reminder, at a glance. Both come from the shared App Group snapshot the
// app writes; the widget computes nothing and interprets nothing.
//
// Colour follows the app's one glucose language, and is never the only signal:
// the value and its unit are always printed beside it.

private enum GlucoseColor {
  // Exact sRGB components of the tokens in lib/theme/tokens.ts, so the widget,
  // the app, the watch and the Android widget cannot drift apart by a shade.
  static let low = Color(red: 1.0, green: 0.3294, blue: 0.4078)        // #ff5468
  static let target = Color(red: 0.1333, green: 0.8902, blue: 0.6039)  // #22e39a
  static let high = Color(red: 1.0, green: 0.8235, blue: 0.2471)       // #ffd23f (E1: yellow)
  static let wellAbove = Color(red: 1.0, green: 0.6275, blue: 0.1647)  // #ffa02a (amber, mid-ramp)
  static let veryHigh = Color(red: 1.0, green: 0.5412, blue: 0.0)      // #ff8a00 (E1: deep orange)
  static let accent = Color(red: 0.1804, green: 0.9020, blue: 1.0)     // #2ee6ff
  static let ink = Color(red: 0.9176, green: 0.9647, blue: 0.9804)     // #eaf6fa
  static let muted = Color(red: 0.5373, green: 0.6392, blue: 0.6902)   // #89a3b0

  /// Colours a reading against the PROFILE's own band (mg/dL) when the snapshot
  /// carries one, falling back to the population defaults + the fixed clinical
  /// ceiling for older snapshots. It is a glance, not a classification.
  ///
  /// The step above the band mirrors lib/glucose.ts classifyGlucose: up to
  /// 1.25x the band's top is the yellow "above" step, past that the amber
  /// "well above" step, so the widget shows the same five-colour ramp the app
  /// and the report do.
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

/// The widget's ground.
///
/// Home-screen families get the brand wash. The lock-screen accessory families
/// get NO ground at all. iOS renders them in its own vibrant material and drops
/// any colour we set, so a brand fill can only ever show up as flat grey - and
/// `AccessoryWidgetBackground()` makes that worse, printing a heavy grey tray
/// behind the text in the gallery and on the lock screen. Bare vibrant
/// text/glyphs on the wallpaper is what this family is meant to look like.
private struct WidgetGround: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch family {
    case .accessoryRectangular, .accessoryInline:
      Color.clear
    default:
      Color("WidgetBackground")
    }
  }
}

struct ZerospikeEntry: TimelineEntry {
  let date: Date
  let data: LiveData?
}

extension LiveData {
  /// Gallery preview / redaction placeholder ONLY: a representative reading so
  /// the widget gallery never shows an empty tile. Never rendered as the user's
  /// own data; the timeline always reads the real snapshot.
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
    usesInsulin: nil,
    usesOralMeds: nil,
    band: nil,
    labels: nil
  )
}

struct ZerospikeProvider: TimelineProvider {
  func placeholder(in context: Context) -> ZerospikeEntry {
    ZerospikeEntry(date: Date(), data: LiveDataStore.read() ?? .placeholderSample)
  }

  func getSnapshot(in context: Context, completion: @escaping (ZerospikeEntry) -> Void) {
    // In the gallery (isPreview) fall back to the sample so the preview is
    // never blank; on the home screen a missing snapshot stays honest (noData).
    let fallback: LiveData? = context.isPreview ? LiveData.placeholderSample : nil
    completion(ZerospikeEntry(date: Date(), data: LiveDataStore.read() ?? fallback))
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

  /// The line under the value: the averaging window, or the honest empty state.
  private var metaLine: String {
    if readingMgdl == nil { return entry.data?.labels?.noData ?? "" }
    return entry.data?.labels?.avgWindow ?? ""
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryInline:
        // Lock-screen inline: one short line the OS tints for us.
        inlineView
      case .accessoryRectangular:
        // Lock-screen rectangular: last reading + time to next reminder.
        rectangularView
      case .systemMedium:
        mediumView
      default:
        smallView
      }
    }
    // Tapping the widget lands on the dashboard (scheme registered in app.json;
    // expo-router resolves the root path to the journal).
    .widgetURL(URL(string: "zerospike:///"))
  }

  /// Home-screen small: the pinned value, its context line, and the countdown
  /// pill pinned to the bottom.
  private var smallView: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(readingLabel)
        .font(.system(size: 10, weight: .bold))
        .foregroundColor(GlucoseColor.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)

      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .foregroundColor(readingColor)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(GlucoseColor.muted)
      }
      .padding(.top, 1)

      Text(metaLine)
        .font(.system(size: 11))
        .foregroundColor(GlucoseColor.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)

      Spacer(minLength: 6)

      if let due = entry.data?.nextReminderDate, due > entry.date {
        countdownPill(due: due, size: 14)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(12)
  }

  /// Home-screen medium: the pinned average on the left, the latest reading and
  /// the reminder countdown on the right, split by a hairline. Same numbers, one
  /// wider glance.
  private var mediumView: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        Text(readingLabel)
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(GlucoseColor.muted)
          .lineLimit(1)
          .minimumScaleFactor(0.8)

        HStack(alignment: .firstTextBaseline, spacing: 5) {
          Text(reading)
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundColor(readingColor)
          Text(entry.data?.unitLabel ?? "")
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(GlucoseColor.muted)
        }
        .padding(.top, 2)

        Text(metaLine)
          .font(.system(size: 11))
          .foregroundColor(GlucoseColor.muted)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
          .fixedSize(horizontal: false, vertical: true)

        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      Rectangle()
        .fill(Color.white.opacity(0.08))
        .frame(width: 1)
        .frame(maxHeight: .infinity)

      VStack(alignment: .leading, spacing: 10) {
        if let lastMgdl = entry.data?.lastGlucoseMgdl,
           let last = entry.data?.displayGlucose {
          VStack(alignment: .leading, spacing: 1) {
            Text(entry.data?.labels?.lastReading ?? "")
              .font(.system(size: 9, weight: .bold))
              .foregroundColor(GlucoseColor.muted)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
              Text(last)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundColor(GlucoseColor.forReading(lastMgdl, band: entry.data?.band))
              Text(entry.data?.unitLabel ?? "")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(GlucoseColor.muted)
            }
          }
        }

        Spacer(minLength: 0)

        if let due = entry.data?.nextReminderDate, due > entry.date {
          VStack(alignment: .leading, spacing: 3) {
            Text(entry.data?.labels?.nextReminder ?? "")
              .font(.system(size: 9, weight: .bold))
              .foregroundColor(GlucoseColor.muted)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
            countdownPill(due: due, size: 15)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(12)
  }

  /// The reminder countdown, in the accent, on its own tinted ground so it reads
  /// as a separate block from the reading above it. Tabular digits, so the pill
  /// does not twitch as the timer ticks.
  ///
  /// The explicit box around the timer is load-bearing. `Text(_:style: .timer)`
  /// asks for the widest string it could EVER show, so left to itself it blows
  /// the pill past the widget's edge and the countdown gets clipped mid-digit
  /// ("1:59:.."). Boxing it to a "0:00:00" measure keeps the pill hugging its
  /// content, and the scale factor absorbs the rare longer countdown.
  private func countdownPill(due: Date, size: CGFloat) -> some View {
    HStack(alignment: .center, spacing: 5) {
      Image(systemName: "timer")
        .font(.system(size: size - 4, weight: .semibold))
        .foregroundColor(GlucoseColor.accent)
      Text(due, style: .timer)
        .font(.system(size: size, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .multilineTextAlignment(.center)
        .foregroundColor(GlucoseColor.accent)
        .frame(width: max(56.0, size * 4.0), alignment: .center)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .background {
      Capsule(style: .continuous)
        .fill(GlucoseColor.accent.opacity(0.14))
    }
    .overlay {
      Capsule(style: .continuous)
        .strokeBorder(GlucoseColor.accent.opacity(0.28), lineWidth: 1)
    }
  }

  /// Lock-screen rectangular accessory: the pinned reading (+ unit) and the
  /// countdown to the next reminder.
  ///
  /// Deliberately NO brand colours and NO ground here. iOS renders this family in
  /// its vibrant material: it takes the LUMINANCE of the content and re-renders it
  /// in the system material, so an explicit cyan or mint is flattened to the same
  /// grey as everything else. What the OS does honour is the hierarchy, so the
  /// primary line stays `.primary` and everything under it uses `.secondary` and
  /// lets the material separate them.
  private var rectangularView: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .font(.system(size: 21, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .foregroundStyle(.primary)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
      }

      if let due = entry.data?.nextReminderDate, due > entry.date {
        HStack(alignment: .center, spacing: 4) {
          Image(systemName: "timer")
            .font(.system(size: 10, weight: .semibold))
          // Same greedy-width trap as the home-screen pill: box the timer or the
          // narrow accessory frame clips it.
          Text(due, style: .timer)
            .font(.system(size: 12, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(width: 56, alignment: .leading)
        }
        .foregroundStyle(.secondary)
      } else {
        Text(readingLabel)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .padding(.vertical, 4)
  }

  /// Lock-screen inline accessory: a single short string (OS-constrained to one
  /// line + an optional glyph), so just the pinned reading and its unit.
  private var inlineView: some View {
    Text("\(reading) \(entry.data?.unitLabel ?? "")")
  }
}

@main
struct ZerospikeWidgetBundle: WidgetBundle {
  var body: some Widget {
    ZerospikeWidget()
    ZerospikeQuickAddWidget()
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
          .containerBackground(for: .widget) { WidgetGround() }
      } else {
        ZerospikeWidgetView(entry: entry)
          .background { WidgetGround() }
      }
    }
    // Gallery-only strings, and the ONLY strings this extension owns. The widget
    // EXTENSION bundle has no localization catalog: @bacons/apple-targets syncs
    // targets/widget as a plain folder and never registers an .lproj, and the
    // app's own locales come from a separate Expo mechanism that only touches the
    // main app target. So these stay English for every user, and must at least be
    // legible instead of the brand name repeated twice. Everything INSIDE the
    // tiles is localized: those labels ride in on the app's snapshot.
    // Journal language only - this widget shows what was logged, nothing else.
    .configurationDisplayName("Glucose summary")
    .description("Your glucose average and the time left on your next reminder.")
    // Home-screen + lock-screen (iOS 16+ accessory) families. The deployment
    // target is 16.4, so the accessory cases are always available here.
    .supportedFamilies([
      .systemSmall,
      .systemMedium,
      .accessoryRectangular,
      .accessoryInline,
    ])
    // iOS 18 tinted/clear home-screen modes must not strip the brand ground;
    // the glucose colours are calibrated against it.
    .containerBackgroundRemovable(false)
  }
}
