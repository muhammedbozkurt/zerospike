import Foundation

// The contract with the phone (R10 FAZ 3). The watch cannot read the iPhone's
// App Group - a WatchKit extension gets its own isolated container per device -
// so this shape arrives instead over WatchConnectivity's applicationContext
// (modules/zerospike-watch-bridge on the phone) and is written here into a
// SEPARATE, watch-local App Group shared only with the watch-widget
// (complications) target. Kept field-identical to targets/widget/LiveData.swift
// (the phone's lib/services/liveData.ts is the single source of the JSON
// shape); duplicated rather than shared because this plugin links each
// targets/<name> folder to exactly one Xcode target.
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

  /// Written by ZerospikeWatchApp's WCSessionDelegate on every incoming
  /// applicationContext; read by ContentView and by the complications target.
  static func write(_ json: String) {
    UserDefaults(suiteName: appGroup)?.set(json, forKey: key)
  }

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
  /// The reading in the user's own display unit (already formatted by the
  /// phone); falls back to a plain conversion for an older cached snapshot.
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

  var lastReadingDate: Date? {
    guard let at = lastGlucoseAt else { return nil }
    return Date(timeIntervalSince1970: at / 1000)
  }

  var nextReminderDate: Date? {
    guard let at = nextReminderAt else { return nil }
    return Date(timeIntervalSince1970: at / 1000)
  }
}
