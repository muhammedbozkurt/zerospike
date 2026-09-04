import AppIntents
import Foundation

// The "Open" button on a zerospike alarm (2.3.0's K2-B).
//
// An AlarmKit alarm is a system surface: the app is not running behind it and
// gets no callback when it fires, so the only way a ringing alarm can lead
// anywhere is a second button backed by an AppIntent. This intent does the
// least it possibly can - it writes WHICH screen the alarm was about into the
// shared App Group and brings the app forward. Everything after that is the
// app's own routing (app/_layout.tsx reads the value on its next foreground
// transition and hands it to the same routeForNotification a tapped
// notification uses), so an alarm tap and a notification tap can never end up
// on two different screens.
//
// `supportedModes: .foreground(.immediate)` is what brings the app forward on
// iOS 26; the older `openAppWhenRun` is deprecated there. If either of these
// names fails to compile against the real SDK, deleting this file plus the
// secondary button and `secondaryIntent` in ZerospikeAlarmKitModule.swift
// leaves the alarm exactly as it was in 2.2.0 - "Stop" only - and nothing else
// in the app changes (see HUMAN-TODO.md).

/// The App Group the main app and the widget extension already share
/// (targets/widget/LiveData.swift). Plain UserDefaults would NOT do here: the
/// intent runs in its own process.
let zerospikeAlarmAppGroup = "group.com.greeneyeapp.zerospike"

/// Where the pending route is parked between the intent running and the app
/// coming forward to read it.
let zerospikeAlarmRouteKey = "zerospike.pendingAlarmRoute"

/// The alarm's own identity string ("zerospike-alarm-<reminderId>"), parked
/// next to the route above so the app can tell WHICH reminder rang, not just
/// which screen to open. Written BEFORE the route key and cleared with it, so
/// a route that is visible to the reader always has its id already in place
/// and an id can never outlive the route it belongs to.
let zerospikeAlarmIdKey = "zerospike.pendingAlarmId"

@available(iOS 26.0, *)
struct ZerospikeAlarmOpenIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Open zerospike"
  static var supportedModes: IntentModes = .foreground(.immediate)

  /// A NotificationRoute value (lib/services/notifications.ts): "glucose",
  /// "med", "basal", "custom" or "postMeal". Deliberately the same vocabulary
  /// as the notification payloads, so the JS side needs no second mapping.
  @Parameter(title: "Route")
  var route: String

  /// The scheduling side's own identity string for this alarm
  /// ("zerospike-alarm-<reminderId>", see alarmIdentifier in
  /// lib/services/notifications.ts). Optional on purpose: an alarm scheduled by
  /// a build that predates this parameter decodes with nothing here, and that
  /// case has to keep opening the app exactly as it did before.
  @Parameter(title: "Alarm")
  var alarmId: String?

  init() {}

  init(route: String, alarmId: String?) {
    self.route = route
    self.alarmId = alarmId
  }

  func perform() async throws -> some IntentResult {
    guard let defaults = UserDefaults(suiteName: zerospikeAlarmAppGroup) else {
      return .result()
    }
    if let alarmId, !alarmId.isEmpty {
      defaults.set(alarmId, forKey: zerospikeAlarmIdKey)
    } else {
      // An alarm with no identity must not inherit the previous alarm's one.
      defaults.removeObject(forKey: zerospikeAlarmIdKey)
    }
    defaults.set(route, forKey: zerospikeAlarmRouteKey)
    return .result()
  }
}
