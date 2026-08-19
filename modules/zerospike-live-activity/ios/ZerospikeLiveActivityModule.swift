import ActivityKit
import ExpoModulesCore
import WidgetKit

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
    /// When the timer was armed. Mirrored from the JS side (lib/postMealTimer.ts)
    /// so the widget extension can render a bounded `timerInterval` that freezes
    /// at 0:00 once `endsAt` passes, instead of the open-ended `.timer` style
    /// (which has no "stop" and counts up past it).
    var startedAt: Date
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

    /// Starts (or updates) the post-meal countdown. `endsAtMs` / `startedAtMs`
    /// are epoch ms, the same clock the JS timer uses.
    Function("start") { (endsAtMs: Double, startedAtMs: Double, title: String, lastReading: String?, unitLabel: String) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

      let endsAt = Date(timeIntervalSince1970: endsAtMs / 1000)
      let state = PostMealAttributes.ContentState(
        startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
        endsAt: endsAt,
        lastReading: lastReading,
        unitLabel: unitLabel
      )
      // Stale from the instant the countdown reaches zero: the widget extension
      // dims the card on `context.isStale` instead of leaving it looking live
      // (and, before the timerInterval change below, counting up past 0:00)
      // until this module's own `end()` call - or an app foreground - takes it
      // down.
      let content = ActivityContent(state: state, staleDate: endsAt)

      // One activity at a time: re-arming the timer updates the running one
      // rather than stacking a second countdown on the lock screen.
      if let running = Activity<PostMealAttributes>.activities.first {
        Task { await running.update(content) }
        return true
      }

      do {
        _ = try Activity.request(
          attributes: PostMealAttributes(title: title),
          content: content,
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

    /// Whether a zerospike WidgetKit widget (the glucose summary or Quick Add,
    /// home screen or Lock Screen) is currently placed anywhere on the device.
    /// `nil` - not `false` - on any WidgetKit error: the dashboard's setup row
    /// reads that as "not checked yet", never as "the user removed it".
    /// getCurrentConfigurations() only ever reports THIS app's own widgets, so
    /// a non-empty list already means "installed", no kind filtering needed.
    AsyncFunction("isWidgetInstalled") { () async -> Bool? in
      await withCheckedContinuation { (continuation: CheckedContinuation<Bool?, Never>) in
        WidgetCenter.shared.getCurrentConfigurations { result in
          switch result {
          case .success(let configurations):
            continuation.resume(returning: !configurations.isEmpty)
          case .failure:
            continuation.resume(returning: nil)
          }
        }
      }
    }
  }
}
