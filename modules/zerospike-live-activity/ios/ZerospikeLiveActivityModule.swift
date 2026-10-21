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

// Last fatal report (A3). An uncaught NSException, which is also how a fatal
// JS error ends in a release build (RCTExceptionsManager -> RCTFatal throws
// "RCTFatalException: Unhandled JS Exception: ..."), is written to one JSON file
// on the device before the process dies. Nothing is sent anywhere; JS reads it
// on the next launch with getLastFatalReport(). A file, not UserDefaults: a
// synchronous atomic write is the only store that reliably lands while the
// process is being torn down.
private let fatalReportFileName = "zerospike-last-fatal.json"
nonisolated(unsafe) private var previousUncaughtHandler: (@convention(c) (NSException) -> Void)?
nonisolated(unsafe) private var fatalHandlerInstalled = false

private func fatalReportURL() -> URL? {
  guard
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
      .first
  else { return nil }
  return base.appendingPathComponent(fatalReportFileName, isDirectory: false)
}

private func clipped(_ text: String, _ limit: Int) -> String {
  text.count > limit ? String(text.prefix(limit)) : text
}

private func recordFatalException(_ exception: NSException) {
  let info = Bundle.main.infoDictionary
  var report: [String: Any] = [
    "platform": "ios",
    "kind": "NSException",
    "name": clipped(exception.name.rawValue, 500),
    "reason": clipped(exception.reason ?? "", 4000),
    "stack": exception.callStackSymbols.prefix(40).map { clipped($0, 300) },
    "build": (info?["CFBundleVersion"] as? String) ?? "",
    "version": (info?["CFBundleShortVersionString"] as? String) ?? "",
    "at": ISO8601DateFormatter().string(from: Date()),
  ]
  // RCTFatal truncates `reason` to 175 characters; the full JS message and
  // stack ride in userInfo under RCTUntruncatedMessageKey.
  if let full = exception.userInfo?["RCTUntruncatedMessageKey"] as? String {
    report["jsMessage"] = clipped(full, 8000)
  }
  guard JSONSerialization.isValidJSONObject(report),
    let data = try? JSONSerialization.data(withJSONObject: report, options: []),
    let url = fatalReportURL()
  else { return }
  try? FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try? data.write(to: url, options: .atomic)
}

private func installFatalExceptionHandler() {
  if fatalHandlerInstalled { return }
  fatalHandlerInstalled = true
  // Chained, not replaced: whatever was installed before still runs, so the
  // system crash report is unchanged.
  previousUncaughtHandler = NSGetUncaughtExceptionHandler()
  NSSetUncaughtExceptionHandler { exception in
    recordFatalException(exception)
    previousUncaughtHandler?(exception)
  }
}

private func readFatalReport() -> String? {
  guard let url = fatalReportURL(), let data = try? Data(contentsOf: url) else { return nil }
  return String(data: data, encoding: .utf8)
}

private func clearFatalReport() -> Bool {
  guard let url = fatalReportURL() else { return false }
  guard FileManager.default.fileExists(atPath: url.path) else { return true }
  do {
    try FileManager.default.removeItem(at: url)
    return true
  } catch {
    return false
  }
}

public class ZerospikeLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZerospikeLiveActivity")

    // Module creation runs while the app context is built, before the JS
    // bundle is evaluated, so a fatal error during JS start-up is covered.
    OnCreate {
      installFatalExceptionHandler()
    }

    /// The last fatal report as a JSON string, or nil when there is none.
    Function("getLastFatalReport") { () -> String? in
      readFatalReport()
    }

    /// Deletes the stored report. True when nothing is left on disk.
    Function("clearLastFatalReport") { () -> Bool in
      clearFatalReport()
    }

    /// Whether the OS and the user's settings allow a Live Activity right now.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    /// Starts (or updates) the post-meal countdown. `endsAtMs` / `startedAtMs`
    /// are epoch ms, the same clock the JS timer uses.
    ///
    /// ASYNC, and it really does await ActivityKit (K3-6). This used to be a
    /// synchronous `Function` that kicked off a detached `Task` and returned
    /// immediately, so JS had no way to know when the work had actually landed:
    /// a start-end-start sequence (log a meal, cancel, log again) could be
    /// applied by ActivityKit in any order, leaving a cancelled countdown on the
    /// lock screen or no countdown at all. Now the promise resolves after the
    /// activity call completes, and the JS side chains the calls on one queue.
    AsyncFunction("start") { (endsAtMs: Double, startedAtMs: Double, title: String, lastReading: String?, unitLabel: String) async -> Bool in
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
        await running.update(content)
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

    /// Refreshes ONLY the reading shown on a running countdown, leaving its
    /// start and end exactly where they are (K3-1).
    ///
    /// The card carries the last reading the user logged, and it was frozen at
    /// whatever that was when the timer was armed: logging a reading, correcting
    /// one, or deleting one during the two-hour window left the lock screen
    /// showing a number the app no longer agreed with. Returns false when there
    /// is nothing running - this never STARTS an activity, because a reading is
    /// not a meal.
    AsyncFunction("update") { (lastReading: String?, unitLabel: String) async -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      guard let running = Activity<PostMealAttributes>.activities.first else { return false }

      let previous = running.content.state
      let state = PostMealAttributes.ContentState(
        startedAt: previous.startedAt,
        endsAt: previous.endsAt,
        lastReading: lastReading,
        unitLabel: unitLabel
      )
      await running.update(ActivityContent(state: state, staleDate: previous.endsAt))
      return true
    }

    /// Ends every running post-meal activity (the timer elapsed, the user logged
    /// their reading early, or they cancelled it). Async for the same reason
    /// `start` is: the caller has to be able to wait for the teardown before
    /// arming the next countdown.
    AsyncFunction("end") { () async -> Void in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<PostMealAttributes>.activities {
        await activity.end(dismissalPolicy: .immediate)
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
