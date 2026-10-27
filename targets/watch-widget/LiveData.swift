import Foundation

// Same contract as targets/watch/LiveData.swift - stays decode-compatible with
// the phone's LiveData (lib/services/liveData.ts, the single source of the
// JSON shape) because JSONDecoder silently ignores any JSON key this struct
// does not declare (e.g. usesInsulin). Duplicated (not shared) because this
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

  /// How the profile gets its readings ("manual" | "cgm" | "nightscout"). `var`
  /// with a nil default so a snapshot written by an older app build still
  /// decodes and the memberwise initializer keeps working; nil reads as manual.
  var mode: String?

  /// The newest SENSOR reading with its trend and age. Present only in a sensor
  /// mode; read it through `activeCgm`. Same decode-compatibility reasoning as
  /// `mode`.
  var cgm: Cgm?

  struct Cgm: Codable {
    let mgdl: Double
    let at: Double
    /// "up2" | "up" | "up45" | "flat" | "down45" | "down" | "down2", or nil when there is no arrow.
    let trend: String?
    let ageMin: Double?
    /// The value pre-formatted in the display unit and the active locale.
    let display: String
  }

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
    /// The generic sensor heading ("CGM", never a brand). Optional like every
    /// label here so an older snapshot still decodes.
    let cgm: String?
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

extension LiveData {
  /// The sensor reading, only while a sensor mode is on. nil means every surface
  /// keeps drawing its manual look unchanged.
  var activeCgm: Cgm? {
    guard let cgm, let mode, mode != "manual" else { return nil }
    return cgm
  }
}

extension LiveData.Cgm {
  /// Older than this the value is drawn faded and without an arrow.
  static let staleAfterMinutes = 20

  func ageMinutes(now: Date) -> Int {
    max(0, Int(now.timeIntervalSince(Date(timeIntervalSince1970: at / 1000)) / 60))
  }

  func isStale(now: Date) -> Bool {
    ageMinutes(now: now) > Self.staleAfterMinutes
  }

  /// Trend arrow, empty once the value is stale. Same glyphs as
  /// cgmTrendGlyph in lib/services/liveDataCgm.ts.
  func arrow(now: Date) -> String {
    if isStale(now: now) { return "" }
    switch trend {
    case "up2": return "↑↑"
    case "up": return "↑"
    case "up45": return "↗"
    case "flat": return "→"
    case "down45": return "↘"
    case "down": return "↓"
    case "down2": return "↓↓"
    default: return ""
    }
  }

  func readingText(now: Date) -> String {
    let glyph = arrow(now: now)
    return glyph.isEmpty ? display : "\(display) \(glyph)"
  }

  /// "4 dk önce" (or "4 dk" when `short`), hand-composed from the app's own
  /// strings for the reason given on smallElapsedLabel in SmallWidgets.swift.
  func ageLabel(_ labels: LiveData.Labels?, now: Date, short: Bool = false) -> String {
    let total = ageMinutes(now: now)
    let hours = total / 60
    let minutes = total % 60
    guard let hourShort = labels?.hourShort, let minuteShort = labels?.minuteShort else {
      return hours > 0 ? "\(hours):\(String(format: "%02d", minutes))" : "\(minutes)"
    }
    let duration = hours > 0
      ? "\(hours) \(hourShort) \(minutes) \(minuteShort)"
      : "\(minutes) \(minuteShort)"
    if short { return duration }
    guard let template = labels?.agoTemplate else { return duration }
    return template.replacingOccurrences(of: "{{t}}", with: duration)
  }
}
