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
  let lastGlucoseAt: Double?
  let nextReminderAt: Double?
  let nextReminderKind: String?

  /// Localized strings the app resolved for us, so the widget never has to own
  /// a second copy of the translations (the app ships five languages).
  let labels: Labels?

  struct Labels: Codable {
    let lastReading: String
    let nextReminder: String
    let noData: String
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
    guard let mgdl = lastGlucoseMgdl else { return nil }
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
