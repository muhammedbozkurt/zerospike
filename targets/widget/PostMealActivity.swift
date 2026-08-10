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

// Exact sRGB components of the Midnight Monitor tokens (lib/theme/tokens.ts).
private let accent = Color(red: 0.1804, green: 0.9020, blue: 1.0)      // #2ee6ff
private let ink = Color(red: 0.9176, green: 0.9647, blue: 0.9804)      // #eaf6fa
private let muted = Color(red: 0.5373, green: 0.6392, blue: 0.6902)    // #89a3b0
private let background = Color(red: 0.0314, green: 0.0549, blue: 0.0784) // #080e14

/// The timer glyph on its accent ground, shared by the lock-screen card and the
/// Dynamic Island's expanded leading region.
@available(iOS 16.2, *)
private func timerBadge(size: CGFloat, corner: CGFloat, glyph: CGFloat) -> some View {
  ZStack {
    RoundedRectangle(cornerRadius: corner, style: .continuous)
      .fill(accent.opacity(0.18))
    Image(systemName: "timer")
      .font(.system(size: glyph, weight: .semibold))
      .foregroundColor(accent)
  }
  .frame(width: size, height: size)
}

/// The last logged reading, as a pill. Value + unit are always printed together;
/// the pill only groups them, it says nothing about them.
@available(iOS 16.2, *)
private func readingPill(_ reading: String, unit: String) -> some View {
  HStack(alignment: .firstTextBaseline, spacing: 4) {
    Text(reading)
      .font(.system(size: 14, weight: .bold, design: .rounded))
      .monospacedDigit()
      .lineLimit(1)
      .foregroundColor(ink)
    Text(unit)
      .font(.system(size: 10, weight: .medium))
      .lineLimit(1)
      .foregroundColor(muted)
  }
  .padding(.horizontal, 9)
  .padding(.vertical, 5)
  .background {
    Capsule(style: .continuous)
      .fill(Color.white.opacity(0.06))
  }
  .overlay {
    Capsule(style: .continuous)
      .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
  }
}

@available(iOS 16.2, *)
struct PostMealActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PostMealAttributes.self) { context in
      // Lock screen / banner
      HStack(spacing: 12) {
        timerBadge(size: 38, corner: 12, glyph: 17)

        VStack(alignment: .leading, spacing: 1) {
          Text(context.attributes.title)
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(muted)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
          // Capped, not fixed: a timer Text asks for the widest string it could
          // ever show, and unchecked it would crowd the reading pill out of the
          // row. The cap still fits "1:59:59" at this size.
          Text(context.state.endsAt, style: .timer)
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: 96, alignment: .leading)
            .foregroundColor(accent)
        }

        Spacer(minLength: 8)

        if let reading = context.state.lastReading {
          readingPill(reading, unit: context.state.unitLabel)
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      .activityBackgroundTint(background)
      .activitySystemActionForegroundColor(accent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          timerBadge(size: 30, corner: 10, glyph: 14)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(muted)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        DynamicIslandExpandedRegion(.trailing) {
          // 64pt only fits "59:59"; a fresh two-hour timer reads "1:59:59" and
          // was losing its tail. 72pt covers that, the scale factor covers the
          // rest.
          Text(context.state.endsAt, style: .timer)
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.trailing)
            .frame(minWidth: 72, alignment: .trailing)
            .foregroundColor(accent)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if let reading = context.state.lastReading {
            HStack(spacing: 0) {
              readingPill(reading, unit: context.state.unitLabel)
              Spacer(minLength: 0)
            }
            .padding(.top, 2)
          }
        }
      } compactLeading: {
        Image(systemName: "timer")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(accent)
      } compactTrailing: {
        // The compact region is tight, so this stays the narrowest box that can
        // still print "1:59:59" - and scales rather than clips if it cannot.
        Text(context.state.endsAt, style: .timer)
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 54)
          .foregroundColor(accent)
      } minimal: {
        Image(systemName: "timer")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(accent)
      }
      // The hairline around the island while the activity is live: the brand
      // cyan, so the pill reads as ours at a glance.
      .keylineTint(accent)
    }
  }
}
