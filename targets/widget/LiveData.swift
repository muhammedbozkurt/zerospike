import Foundation

// The contract with the app. lib/services/liveData.ts writes exactly this JSON
// to the shared App Group under LIVE_DATA_KEY; nothing here derives or
// interprets anything, it only renders what the user already logged.
//
// Keep these field names in sync with the LiveData interface in
// lib/services/liveData.ts. They are the whole seam between JS and Swift.
struct LiveData: Codable {
  let updatedAt: Double
  let unit: String
  let lastGlucoseMgdl: Double?
  /// Pre-formatted reading (display unit + active locale). Optional so a snapshot
  /// written by an older app build still decodes; falls back to local formatting.
  let lastGlucoseDisplay: String?
  let lastGlucoseAt: Double?
  /// Rolling average over the last `avgWindowDays` (mg/dL) + its pre-formatted
  /// display string. The home widget pins THIS (a persistent number) rather than a
  /// single stale reading. Optional so a pre-R10 snapshot still decodes.
  let avgGlucoseMgdl: Double?
  let avgGlucoseDisplay: String?
  let avgWindowDays: Double?
  let nextReminderAt: Double?
  let nextReminderKind: String?

  /// The profile's own colour band (mg/dL). Optional so a snapshot written by an
  /// older app build (before R7) still decodes; the widget then falls back to the
  /// population defaults.
  let band: Band?

  /// Localized strings the app resolved for us, so the widget never has to own
  /// a second copy of the translations (the app ships five languages).
  let labels: Labels?

  struct Band: Codable {
    let hypo: Double
    let low: Double
    let high: Double
    let veryHigh: Double
  }

  struct Labels: Codable {
    let lastReading: String
    let avgGlucose: String?
    let avgWindow: String?
    let nextReminder: String
    let noData: String
    // Optional: absent on an older cached snapshot written before this field
    // existed, so decode must never fail on a stale App Group value.
    let hourShort: String?
    let minuteShort: String?
    let agoTemplate: String?
  }
}

enum LiveDataStore {
  static let appGroup = "group.com.greeneyeapp.zerospike"
  static let key = "zerospike.liveData"

  static func read() -> LiveData? {
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let raw = defaults.string(forKey: key),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(LiveData.self, from: data)
  }
}

extension LiveData {
  /// The reading in the user's own display unit. Storage is always mg/dL; this
  /// is the only place the widget converts, mirroring lib/glucose.ts.
  var displayGlucose: String? {
    // Prefer the app's own locale-formatted string (so tr/de show "6,4"); only
    // fall back to a dot-formatted value for a pre-R7.1 snapshot.
    if let pre = lastGlucoseDisplay { return pre }
    guard let mgdl = lastGlucoseMgdl else { return nil }
    if unit == "mmol" {
      return String(format: "%.1f", mgdl / 18.0182)
    }
    return String(Int(mgdl.rounded()))
  }

  /// The rolling average in the user's display unit - what the home widget pins.
  var displayAverage: String? {
    if let pre = avgGlucoseDisplay { return pre }
    guard let mgdl = avgGlucoseMgdl else { return nil }
    if unit == "mmol" {
      return String(format: "%.1f", mgdl / 18.0182)
    }
    return String(Int(mgdl.rounded()))
  }

  var unitLabel: String {
    unit == "mmol" ? "mmol/L" : "mg/dL"
  }

  var lastReadingDate: Date? {
    guard let at = lastGlucoseAt else { return nil }
    return Date(timeIntervalSince1970: at / 1000)
  }

  var nextReminderDate: Date? {
    guard let at = nextReminderAt else { return nil }
    return Date(timeIntervalSince1970: at / 1000)
  }
}
