import SwiftUI

// The watch app's single screen (R10 FAZ 3): the last logged reading in the
// app's one glucose colour language, how long ago it was measured, and - when
// a post-meal timer is running - the time left on it. Descriptive only, same
// as every other glanceable surface (home widget, Live Activity): it reports
// what was already logged on the phone, never advice, never a dose.
//
// The countdown uses SwiftUI's built-in `Text(due, style: .timer)` (digits and
// a colon only, nothing to localize). The "ago" line does NOT use `Text(date,
// style: .relative)` - that formatter is localized to the WATCH's system
// language, which can differ from the app's in-app language (the phone's
// screenshot-mode language, or a user who picked a different in-app language
// than their watch's system one), producing a mismatched sentence. Instead it
// is hand-composed from `labels.hourShort/minuteShort/agoTemplate`, already
// resolved by the phone's i18n, same as `labels.noData`.

private enum GlucoseColor {
  // Exact sRGB components of the tokens in lib/theme/tokens.ts.
  static let low = Color(red: 1.0, green: 0.3294, blue: 0.4078)        // #ff5468
  static let target = Color(red: 0.1333, green: 0.8902, blue: 0.6039)  // #22e39a
  static let high = Color(red: 1.0, green: 0.8235, blue: 0.2471)       // #ffd23f
  static let wellAbove = Color(red: 1.0, green: 0.6275, blue: 0.1647)  // #ffa02a
  static let veryHigh = Color(red: 1.0, green: 0.5412, blue: 0.0)      // #ff8a00
  static let accent = Color(red: 0.1333, green: 0.7804, blue: 0.8784)  // #22c7e0
  static let muted = Color(red: 0.5373, green: 0.6392, blue: 0.6902)   // #89a3b0
  // Same literal as the phone widget's WidgetBackground (#080e14), so every
  // zerospike surface sits on the one Midnight Monitor ground.
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

struct ContentView: View {
  @State private var data: LiveData? = LiveDataStore.read()
  // Applies a freshly-pushed context without waiting for the view to re-appear.
  private let refresh = Timer.publish(every: 20, on: .main, in: .common).autoconnect()

  private var readingMgdl: Double? { data?.lastGlucoseMgdl }
  private var reading: String { data?.displayGlucose ?? "--" }
  private var readingColor: Color {
    guard let mgdl = readingMgdl else { return GlucoseColor.muted }
    return GlucoseColor.forReading(mgdl, band: data?.band)
  }

  // Hand-composed instead of `Text(date, style: .relative)` - see the header
  // comment for why. Re-evaluated on every `refresh` tick.
  private var elapsedText: String {
    guard let date = data?.lastReadingDate else { return "" }
    let totalMinutes = max(0, Int(Date().timeIntervalSince(date) / 60))
    let hours = totalMinutes / 60
    let minutes = totalMinutes % 60
    guard
      let labels = data?.labels,
      let hourShort = labels.hourShort,
      let minuteShort = labels.minuteShort,
      let template = labels.agoTemplate
    else {
      // Older cached snapshot without these fields: numeric fallback.
      return hours > 0 ? "\(hours):\(String(format: "%02d", minutes))" : "\(minutes)"
    }
    let duration = hours > 0
      ? "\(hours) \(hourShort) \(minutes) \(minuteShort)"
      : "\(minutes) \(minuteShort)"
    return template.replacingOccurrences(of: "{{t}}", with: duration)
  }

  var body: some View {
    // The brand ground was never set before, so the screen fell back to plain
    // system black. `.background` covers every watchOS this target runs on;
    // watchOS 10 additionally paints the system container (the area behind the
    // toolbar/status bar) via containerBackground.
    if #available(watchOS 10.0, *) {
      content.containerBackground(GlucoseColor.background, for: .navigation)
    } else {
      content
    }
  }

  private var content: some View {
    VStack(spacing: 4) {
      Text(reading)
        .font(.system(size: 40, weight: .bold, design: .rounded))
        .foregroundColor(readingColor)
        .minimumScaleFactor(0.5)

      Text(data?.unitLabel ?? "")
        .font(.caption2)
        .foregroundColor(GlucoseColor.muted)

      if data?.lastReadingDate != nil {
        Text(elapsedText)
          .font(.footnote)
          .foregroundColor(GlucoseColor.muted)
      } else {
        Text(data?.labels?.noData ?? "")
          .font(.footnote)
          .foregroundColor(GlucoseColor.muted)
      }

      if let due = data?.nextReminderDate, due > Date() {
        VStack(spacing: 1) {
          Text(data?.labels?.nextReminder ?? "")
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(GlucoseColor.muted)
          Text(due, style: .timer)
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .foregroundColor(GlucoseColor.accent)
        }
        .padding(.top, 4)
      }
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(GlucoseColor.background.ignoresSafeArea())
    .onReceive(refresh) { _ in
      data = LiveDataStore.read()
    }
  }
}

#Preview {
  ContentView()
}
