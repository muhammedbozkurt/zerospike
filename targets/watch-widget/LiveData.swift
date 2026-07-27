import Foundation

// Same contract as targets/watch/LiveData.swift - kept field-identical to the
// phone's lib/services/liveData.ts. Duplicated (not shared) because this
// plugin links each targets/<name> folder to exactly one Xcode target; this
// target only ever READS the store (targets/watch's WCSessionDelegate is the
// only writer).
struct LiveData: Codable {
  let updatedAt: Double
  let unit: String
  let lastGlucoseMgdl: Double?
  let lastGlucoseDisplay: String?
  let lastGlucoseAt: Double?
  let avgGlucoseMgdl: Double?
  let avgGlucoseDisplay: String?
  let avgWindowDays: Double?
  let nextReminderAt: Double?
  let nextReminderKind: String?
  let band: Band?
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
  var displayGlucose: String? {
    if let pre = lastGlucoseDisplay { return pre }
    guard let mgdl = lastGlucoseMgdl else { return nil }
    if unit == "mmol" {
      return String(format: "%.1f", mgdl / 18.0182)
    }
    return String(Int(mgdl.rounded()))
  }

  var unitLabel: String {
    unit == "mmol" ? "mmol/L" : "mg/dL"
  }

  var nextReminderDate: Date? {
    guard let at = nextReminderAt else { return nil }
    return Date(timeIntervalSince1970: at / 1000)
  }
}
