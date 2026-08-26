import Foundation
import SwiftUI

// The contract with the app. lib/services/liveData.ts writes exactly this JSON
// to the shared App Group under LIVE_DATA_KEY; nothing here derives or
// interprets anything, it only renders what the user already logged.
//
// Keep these field names in sync with the LiveData interface in
// lib/services/liveData.ts. They are the whole seam between JS and Swift.
struct LiveData: Codable {
  let updatedAt: Double
  let unit: String
  /// The active in-app language (e.g. "ar"), so a native surface can mirror the
  /// app's own writing direction instead of the device's system language.
  /// Optional so a snapshot written by an older app build still decodes; a
  /// missing value means the surface keeps the device's own layout direction.
  let lang: String?
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

  /// What the next reminder is CALLED, already localized by the app (the user's
  /// own row name, or the plain type noun). Optional so a snapshot written by an
  /// older app build still decodes; the lock-screen families then lead with the
  /// generic "next reminder" heading and the plain COUNTDOWN, which is exactly
  /// what they drew before this field existed (see `hasReminderName`).
  let nextReminderLabel: String?

  /// How that reminder will actually be delivered: "alarm" or "notification",
  /// from the same three-way AND applyReminders arms with. Optional for the same
  /// reason; a missing value draws the bell rather than promising an alarm.
  let nextReminderMode: String?

  /// End of a RUNNING post-meal window. Carried separately from
  /// `nextReminderAt` because the lock-screen families give a ticking countdown
  /// the top line even when a daily reminder is due sooner. Optional: an older
  /// snapshot simply has no running timer to promote.
  let postMealEndsAt: Double?

  /// Whether the profile uses insulin at all (insulin_mode != "none"). Drives the
  /// Quick Add injection shortcut, so the home screen matches what the app itself
  /// shows. Optional: a snapshot written by an older app build carries no such
  /// key, and callers then keep the shortcut (see QuickAdd.swift).
  let usesInsulin: Bool?

  /// Whether the profile tracks oral medication (oral_meds_enabled = 1). Drives
  /// the Quick Add medication shortcut. Optional, and unlike `usesInsulin` the
  /// missing value here means HIDDEN: an older snapshot must not grow a tile the
  /// build that wrote it never had (see QuickAdd.swift).
  let usesOralMeds: Bool?

  /// The profile's own colour band (mg/dL). Optional so a snapshot written by an
  /// older app build (before R7) still decodes; the widget then falls back to the
  /// population defaults.
  let band: Band?

  /// Localized strings the app resolved for us, so the widget never has to own
  /// a second copy of the translations (the app ships nine languages).
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
    // Quick Add widget shortcut titles (see QuickAdd.swift). Also optional so
    // a pre-quick-add snapshot still decodes.
    let quickAdd: String?
    let addGlucose: String?
    let addMeal: String?
    let addInjection: String?
    /// The medication tile's title. Carries the app's own `meds.entryLabel`
    /// noun, so the tile needs no translation of its own.
    let addMed: String?
    /// The post-meal countdown's own heading (`widget.timerTitle`), for the
    /// timer widget's running state. Optional like every label above: a
    /// snapshot written before this field existed still decodes, and the tile
    /// then draws the glyph and the countdown with no heading rather than an
    /// English one this extension would have to own.
    let timerTitle: String?
    /// The "start the countdown" call to action (`dashboard.startCountdown`),
    /// for the timer widget's IDLE state. Optional AND nullable on the JS side:
    /// the app sends null while that key is still untranslated, and the tile
    /// falls back to the brand name rather than printing a raw i18n key.
    let startCountdown: String?
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

  /// End of the running post-meal window, when one is counting down.
  var postMealEndsDate: Date? {
    guard let at = postMealEndsAt else { return nil }
    return Date(timeIntervalSince1970: at / 1000)
  }

  /// The SF Symbol for how the next reminder will reach the user. A missing or
  /// unrecognised mode draws the bell: an alarm glyph is a promise the OS has
  /// to keep, so it is only drawn when the app said so out loud.
  var nextReminderGlyph: String {
    nextReminderMode == "alarm" ? "alarm" : "bell"
  }
}

/// The writing direction the given in-app language calls for, mirroring
/// `isRTLLang` in lib/i18n/index.ts: "ar" is the only in-app language that
/// reads right-to-left. `nil` for a missing `lang` (a pre-Wave-3h snapshot, or
/// a decode failure) so the caller falls back to the device's own layout
/// direction instead of asserting one.
func layoutDirection(forLang lang: String?) -> LayoutDirection? {
  guard let lang else { return nil }
  return lang == "ar" ? .rightToLeft : .leftToRight
}

extension View {
  /// Applies an explicit layout direction, or leaves the environment
  /// untouched when `direction` is `nil` so the view falls back to whatever
  /// direction its parent (ultimately the device) already set.
  @ViewBuilder
  func applyingLayoutDirection(_ direction: LayoutDirection?) -> some View {
    if let direction {
      environment(\.layoutDirection, direction)
    } else {
      self
    }
  }
}
