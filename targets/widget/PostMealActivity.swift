import ActivityKit
import SwiftUI
import WidgetKit

// The post-meal Live Activity: a lock-screen card and a Dynamic Island pill
// counting down to the reminder the user armed. Timer-style, so iOS renders the
// countdown itself and no push notifications are needed.
//
// The attributes carry only what the user already logged: the end time of their
// own timer and their last reading. Nothing is interpreted; the activity says
// how long is left, and that is all.

@available(iOS 16.2, *)
struct PostMealAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// When the post-meal check is due.
    var endsAt: Date
    /// Last logged reading, already formatted in the user's unit (or nil).
    var lastReading: String?
    /// The unit label to print beside it.
    var unitLabel: String
  }

  /// Localized once by the app, so the extension owns no translations.
  var title: String
}

private let accent = Color(red: 0.18, green: 0.90, blue: 1.0)
private let ink = Color(red: 0.92, green: 0.96, blue: 0.98)
private let muted = Color(red: 0.54, green: 0.64, blue: 0.69)
private let background = Color(red: 0.03, green: 0.05, blue: 0.08)

@available(iOS 16.2, *)
struct PostMealActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PostMealAttributes.self) { context in
      // Lock screen / banner
      HStack(spacing: 12) {
        ZStack {
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .fill(accent.opacity(0.18))
            .frame(width: 36, height: 36)
          Image(systemName: "timer")
            .foregroundColor(accent)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(context.attributes.title)
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(muted)
          Text(context.state.endsAt, style: .timer)
            .font(.system(size: 17, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(ink)
        }
        Spacer()
        if let reading = context.state.lastReading {
          VStack(alignment: .trailing, spacing: 1) {
            Text(reading)
              .font(.system(size: 15, weight: .bold, design: .rounded))
              .monospacedDigit()
              .foregroundColor(ink)
            Text(context.state.unitLabel)
              .font(.system(size: 9))
              .foregroundColor(muted)
          }
        }
      }
      .padding(14)
      .activityBackgroundTint(background)
      .activitySystemActionForegroundColor(accent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "timer").foregroundColor(accent)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(muted)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.endsAt, style: .timer)
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(ink)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if let reading = context.state.lastReading {
            Text("\(reading) \(context.state.unitLabel)")
              .font(.system(size: 12))
              .foregroundColor(muted)
          }
        }
      } compactLeading: {
        Image(systemName: "timer").foregroundColor(accent)
      } compactTrailing: {
        Text(context.state.endsAt, style: .timer)
          .monospacedDigit()
          .frame(maxWidth: 44)
          .foregroundColor(ink)
      } minimal: {
        Image(systemName: "timer").foregroundColor(accent)
      }
    }
  }
}
