import ActivityKit
import ExpoModulesCore

// Starts and ends the post-meal Live Activity. Deliberately thin: JS already
// owns WHEN the post-meal timer runs (lib/services/notifications.ts), so this
// only mirrors that decision onto the lock screen and Dynamic Island.
//
// Timer-style with no push token, so nothing leaves the device: iOS renders the
// countdown itself from the end date. The attributes carry no health record
// beyond the reading the user just logged, already formatted for display.
//
// Every entry point degrades quietly. A device without Live Activities, a user
// who disabled them, or an OS below 16.2 must never make logging a meal fail.

@available(iOS 16.2, *)
struct PostMealAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var endsAt: Date
    var lastReading: String?
    var unitLabel: String
  }

  var title: String
}

public class ZerospikeLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZerospikeLiveActivity")

    /// Whether the OS and the user's settings allow a Live Activity right now.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    /// Starts (or updates) the post-meal countdown. `endsAtMs` is epoch ms, the
    /// same clock the JS timer uses.
    Function("start") { (endsAtMs: Double, title: String, lastReading: String?, unitLabel: String) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

      let state = PostMealAttributes.ContentState(
        endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
        lastReading: lastReading,
        unitLabel: unitLabel
      )

      // One activity at a time: re-arming the timer updates the running one
      // rather than stacking a second countdown on the lock screen.
      if let running = Activity<PostMealAttributes>.activities.first {
        Task { await running.update(using: state) }
        return true
      }

      do {
        _ = try Activity.request(
          attributes: PostMealAttributes(title: title),
          contentState: state,
          pushType: nil
        )
        return true
      } catch {
        return false
      }
    }

    /// Ends every running post-meal activity (the timer elapsed, the user logged
    /// their reading early, or they cancelled it).
    Function("end") { () -> Void in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<PostMealAttributes>.activities {
        Task { await activity.end(dismissalPolicy: .immediate) }
      }
    }
  }
}
