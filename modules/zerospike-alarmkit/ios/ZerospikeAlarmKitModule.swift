import AlarmKit
import ExpoModulesCore
import SwiftUI

// Schedules zerospike reminders as real AlarmKit alarms (iOS 26+, WWDC25 "Wake
// up to the AlarmKit API"). Deliberately thin, exactly like
// ZerospikeLiveActivityModule.swift: JS already owns WHICH reminder rows opt
// in and WHEN they fire (lib/services/notifications.ts), so this module only
// mirrors that decision onto AlarmManager - it never decides on its own
// whether a reminder should ring as an alarm.
//
// AlarmKit's public surface takes a UUID identity, not an arbitrary string, so
// this module keeps a small identity map (JS's own "zerospike-alarm-<id>"
// string -> the UUID AlarmKit actually knows) in UserDefaults. That map is
// reversible in both directions: scheduleDailyAlarm/cancelAlarm look a string
// id up (or mint one, once, the first time it is seen), and
// listScheduledAlarmIds walks it the other way so the JS-side orphan sweep
// (mirroring the "zerospike-rem-" notification sweep in applyReminders) can
// work off plain strings without ever seeing a UUID.
//
// Every entry point degrades quietly: an OS below 26, a denied/undetermined
// authorization, or an AlarmKit error must never make saving a reminder fail -
// same contract ZerospikeLiveActivityModule.swift already keeps for the
// post-meal countdown.
//
// API surface below (isAvailable/getAuthorizationStatus/requestAuthorization/
// scheduleDailyAlarm/cancelAlarm/listScheduledAlarmIds) and every AlarmKit call
// inside each function is sourced from, and cross-checked against, multiple
// independent 2026 AlarmKit references (WWDC25 session 230, Apple's own
// "Scheduling an alarm with AlarmKit" doc, and real compiling Swift samples in
// createwithswift.com's "Scheduling and Managing Alarms in SwiftUI with
// AlarmKit" and BleepingSwift's "Scheduling Alarms with AlarmKit") - see the
// per-function comments below for exactly which call each source confirms.
// This sandbox has no Xcode 26/iOS 26 SDK to type-check against, so only
// `swiftc -parse` (syntax only) was run here; a real device/simulator build is
// still required before shipping - see the module's own report note.

/// AlarmAttributes is generic over an app-supplied AlarmMetadata payload that
/// rides along to the alarm UI. zerospike's alarms carry nothing beyond the
/// title/stop button already in the presentation, so this is the minimal
/// conforming type (AlarmMetadata refines Codable & Hashable; an empty struct
/// synthesizes both). The first real Xcode 26 build proved there is no
/// SDK-provided empty metadata type ("cannot find type 'EmptyMetadata'"), so
/// the app defines its own, as Apple's samples do.
@available(iOS 26.0, *)
struct ZerospikeAlarmMetadata: AlarmMetadata {}

/// UserDefaults key for the identity map (JS string id -> AlarmKit UUID
/// string). Plain UserDefaults, not the shared App Group store: only the main
/// app process ever schedules or reads a zerospike alarm, unlike LiveData
/// (read by a widget extension) or the watch bridge.
private let idMapKey = "zerospike.alarmkit.idMap"

private func loadIdMap() -> [String: String] {
  (UserDefaults.standard.dictionary(forKey: idMapKey) as? [String: String]) ?? [:]
}

private func saveIdMap(_ map: [String: String]) {
  UserDefaults.standard.set(map, forKey: idMapKey)
}

/// The UUID AlarmKit should use for `id` (JS's "zerospike-alarm-<reminderId>"
/// string). Minted once per string id and persisted from then on, so
/// re-arming the SAME reminder (a time edit, a language change re-arm) always
/// targets the alarm AlarmKit already has instead of leaving a duplicate
/// behind - the same "same fixed identifier replaces the pending one" contract
/// every notification scheduler in lib/services/notifications.ts already
/// keeps, adapted to AlarmKit's UUID-only identity.
///
/// Also reports whether THIS call minted the entry (vs. reusing one already in
/// the map), so a caller whose schedule attempt then fails can decide whether
/// to roll a freshly-created entry back - see scheduleDailyAlarm below.
private func uuidForIdentity(_ id: String) -> (uuid: UUID, wasFresh: Bool) {
  var map = loadIdMap()
  if let existing = map[id], let uuid = UUID(uuidString: existing) {
    return (uuid, false)
  }
  let fresh = UUID()
  map[id] = fresh.uuidString
  saveIdMap(map)
  return (fresh, true)
}

private func forgetIdentity(_ id: String) {
  var map = loadIdMap()
  guard map.removeValue(forKey: id) != nil else { return }
  saveIdMap(map)
}

/// The zerospike brand accent (#22d3ee - same hex `lightColor` already used for
/// the Android reminders channel in lib/services/notifications.ts and
/// THEME.accent in lib/theme/tokens.ts), so the system alarm screen's tint
/// matches the rest of the app instead of AlarmKit's own default.
private let alarmTint = Color(red: 34.0 / 255, green: 211.0 / 255, blue: 238.0 / 255)

public class ZerospikeAlarmKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZerospikeAlarmKit")

    /// Whether AlarmKit exists on this OS at all (iOS 26+). Does NOT mean
    /// authorized - callers check getAuthorizationStatus()/requestAuthorization()
    /// separately, exactly like ZerospikeLiveActivityModule.isAvailable() only
    /// reports OS+user capability, not a granted state.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 26.0, *) { return true }
      return false
    }

    /// Reads the current authorization WITHOUT prompting. `authorizationState`
    /// is a plain synchronous property (confirmed by createwithswift.com's
    /// walkthrough, which reads it directly inside a `switch` with no `await`)
    /// with exactly three cases - .notDetermined / .authorized / .denied - so
    /// this never needs to touch the async requestAuthorization() path just to
    /// report where things stand.
    Function("getAuthorizationStatus") { () -> String in
      guard #available(iOS 26.0, *) else { return "unavailable" }
      switch AlarmManager.shared.authorizationState {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .notDetermined: return "notDetermined"
      @unknown default: return "unavailable"
      }
    }

    /// Prompts for AlarmKit authorization (system dialog, comparable to
    /// requestNotificationPermission in lib/services/notifications.ts) and
    /// reports the real outcome. `requestAuthorization()` is `async throws`
    /// returning the same three-case state (confirmed by both
    /// createwithswift.com's `try await alarmManager.requestAuthorization()`
    /// and the ADHDAlarms sample's `try await AlarmManager.shared.requestAuthorization()`).
    /// Never throws out to JS: a failed prompt reports "unavailable" rather
    /// than crashing the save flow, matching requestNotificationPermission's
    /// own never-throws contract.
    AsyncFunction("requestAuthorization") { () -> String in
      guard #available(iOS 26.0, *) else { return "unavailable" }
      do {
        switch try await AlarmManager.shared.requestAuthorization() {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unavailable"
        }
      } catch {
        return "unavailable"
      }
    }

    /// Schedules (or re-arms) a daily-repeating alarm at `hour:minute`, every
    /// day of the week - the only recurrence zerospike's reminders need (a
    /// fixed daily time, exactly like the DAILY trigger applyReminders already
    /// uses for the notification path). `id` is JS's own
    /// "zerospike-alarm-<reminderId>" string (see alarmIdentifier in
    /// lib/services/notifications.ts); `label` is the already-localized alarm
    /// title and `stopLabel` the already-localized stop-button text - this
    /// module owns no copy of its own, same as PostMealAttributes.title being
    /// handed in fully formed by the JS layer.
    ///
    /// Re-arms by cancelling whatever this SAME id previously scheduled first:
    /// AlarmKit's own re-schedule-in-place behavior under an unchanged id is
    /// not documented clearly enough across sources to rely on, and a
    /// cancel-then-schedule pair costs nothing extra (cancelling an
    /// already-gone alarm is a caught no-op) - mirrors every
    /// cancel-then-reschedule pair already in lib/services/notifications.ts
    /// (e.g. scheduleBasalReminder).
    ///
    /// Sources for the calls below: Alarm.Schedule.Relative / .Time(hour:minute:)
    /// / Alarm.Schedule.Relative.Recurrence.weekly([...]) and
    /// Alarm.Schedule.relative(...) are confirmed verbatim by a WebSearch-surfaced
    /// AlarmKit weekday-alarm sample (7-day-capable .weekly recurrence) and by
    /// the Apple "Scheduling an alarm with AlarmKit" doc (Alarm.Schedule.fixed
    /// counterpart for a one-off date). AlarmPresentation.Alert(title:stopButton:),
    /// AlarmButton(text:textColor:systemImageName:) and
    /// AlarmAttributes<EmptyMetadata>(presentation:tintColor:) are confirmed
    /// verbatim by createwithswift.com's scheduleTimer() sample. The
    /// AlarmManager.AlarmConfiguration(schedule:attributes:) convenience
    /// initializer (defaulting sound/countdownDuration/stopIntent/secondaryIntent)
    /// is confirmed by the same Apple doc showing an
    /// `AlarmConfiguration(schedule: .fixed(date), attributes:)` call; the fully
    /// qualified `AlarmManager.AlarmConfiguration` spelling (rather than a bare
    /// `AlarmConfiguration`) is used here because one source states the type is
    /// namespaced under AlarmManager, and the qualified form compiles either way.
    /// AlarmManager.shared.schedule(id:configuration:) is confirmed by every
    /// source consulted. A custom secondary (snooze) button/intent is
    /// deliberately NOT wired in this wave - the system's own stop control is
    /// enough for a v1, and a custom AppIntent-backed snooze is real extra
    /// surface (see the module's own report note).
    AsyncFunction("scheduleDailyAlarm") {
      (id: String, hour: Int, minute: Int, label: String, stopLabel: String) -> Bool in
      guard #available(iOS 26.0, *) else { return false }
      guard AlarmManager.shared.authorizationState == .authorized else { return false }

      let (uuid, wasFresh) = uuidForIdentity(id)
      try? await AlarmManager.shared.cancel(id: uuid)

      let time = Alarm.Schedule.Relative.Time(hour: hour, minute: minute)
      let recurrence = Alarm.Schedule.Relative.Recurrence.weekly([
        .sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday,
      ])
      let schedule = Alarm.Schedule.relative(
        Alarm.Schedule.Relative(time: time, repeats: recurrence)
      )

      let stopButton = AlarmButton(
        text: LocalizedStringResource(stringLiteral: stopLabel),
        textColor: .white,
        systemImageName: "stop.fill"
      )
      let alert = AlarmPresentation.Alert(
        title: LocalizedStringResource(stringLiteral: label),
        stopButton: stopButton
      )
      let attributes = AlarmAttributes<ZerospikeAlarmMetadata>(
        presentation: AlarmPresentation(alert: alert),
        tintColor: alarmTint
      )
      let configuration = AlarmManager.AlarmConfiguration(
        schedule: schedule,
        attributes: attributes
      )

      do {
        _ = try await AlarmManager.shared.schedule(id: uuid, configuration: configuration)
        return true
      } catch {
        // A freshly minted identity that never actually got scheduled must not
        // linger in the map: the next attempt for this SAME id would otherwise
        // skip straight to cancel+schedule against a UUID AlarmKit never held
        // anything under, instead of minting a clean one. An identity that
        // already existed before this call (a re-arm) is left alone - AlarmKit
        // still had whatever the cancel() above just removed scheduled under
        // it a moment ago, so retrying the SAME id on the next attempt is
        // correct, not stale.
        if wasFresh { forgetIdentity(id) }
        return false
      }
    }

    /// Cancels the alarm behind JS's own `id` string. `cancel(id:)`, not
    /// `stop(id:)`: a public AlarmKit forum report found while researching this
    /// module notes `stop` only resets a SCHEDULED (non-timer) alarm back to
    /// `.scheduled` rather than removing it, while `cancel` is what actually
    /// deletes it - exactly the "gone for good" behavior a deleted/disabled
    /// reminder row needs. Returns whether an id was actually known here, for
    /// symmetry with the JS-side cancelReminderIdentifier's own best-effort/
    /// no-throw contract.
    ///
    /// The identity mapping is only forgotten once AlarmKit confirms the
    /// cancel - not upfront: forgetting it first and then having the cancel
    /// call fail would leave AlarmKit still holding the alarm under a UUID no
    /// string id points to any more, permanently unreachable from JS (it can
    /// never again appear in listScheduledAlarmIds, so the orphan sweep in
    /// applyReminders would never find it either). The unknown-id branch above
    /// never had anything to forget, so it is unaffected by this move.
    AsyncFunction("cancelAlarm") { (id: String) -> Bool in
      guard #available(iOS 26.0, *) else { return false }
      let map = loadIdMap()
      guard let uuidString = map[id], let uuid = UUID(uuidString: uuidString) else {
        return false
      }
      do {
        try await AlarmManager.shared.cancel(id: uuid)
        forgetIdentity(id)
        return true
      } catch {
        return false
      }
    }

    /// The JS-string ids ("zerospike-alarm-<reminderId>") this module has
    /// scheduled AND that AlarmKit still actually holds - the two-way check the
    /// orphan sweep in applyReminders needs, mirroring how it already reads
    /// getAllScheduledNotificationsAsync() for the "zerospike-rem-" prefix.
    /// `AlarmManager.shared.alarms` is a plain synchronous `[Alarm]` property
    /// (confirmed by the BleepingSwift sample, which returns it directly with
    /// no `await`), covering only alarms THIS app created - no prefix filtering
    /// needed on AlarmKit's own side, only against this module's own map.
    Function("listScheduledAlarmIds") { () -> [String] in
      guard #available(iOS 26.0, *) else { return [] }
      let map = loadIdMap()
      let liveUuids = Set(AlarmManager.shared.alarms.map { $0.id.uuidString })
      return map.compactMap { key, value in liveUuids.contains(value) ? key : nil }
    }
  }
}
