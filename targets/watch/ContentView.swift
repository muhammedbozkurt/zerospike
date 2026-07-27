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
  static let low = Color(red: 1.0, green: 0.33, blue: 0.41)      // #ff5468
  static let target = Color(red: 0.13, green: 0.89, blue: 0.60)  // #22e39a
  static let high = Color(red: 1.0, green: 0.824, blue: 0.247)   // #ffd23f
  static let veryHigh = Color(red: 1.0, green: 0.541, blue: 0.0) // #ff8a00
  static let accent = Color(red: 0.18, green: 0.90, blue: 1.0)   // #2ee6ff
  static let muted = Color(red: 0.54, green: 0.64, blue: 0.69)   // #89a3b0

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
    .onReceive(refresh) { _ in
      data = LiveDataStore.read()
    }
  }
}

#Preview {
  ContentView()
}
