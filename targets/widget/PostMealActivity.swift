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
    /// When the timer was armed. Kept in sync with the module's own copy of
    /// this struct (modules/zerospike-live-activity/ios) - ActivityKit decodes
    /// by field name across the two targets, so they must match exactly.
    var startedAt: Date
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

/// Colours for one surface. The lock-screen card follows the system appearance
/// through the asset catalog; the Dynamic Island is always black, so it keeps
/// fixed dark tones.
private struct ActivityTones {
  let accent: Color
  let ink: Color
  let muted: Color

  static let card = ActivityTones(
    accent: WidgetPalette.activityAccent, ink: WidgetPalette.ink, muted: WidgetPalette.muted)
  static let island = ActivityTones(
    accent: WidgetPalette.islandAccent, ink: WidgetPalette.islandInk,
    muted: WidgetPalette.islandMuted)
}

/// A closed range `Text(timerInterval:)` can render safely, even if a
/// persisted state ever violated the start-before-end invariant (never
/// expected in practice: the JS side always derives `endsAt` as `startedAt`
/// plus a window of at least a minute). `ClosedRange` traps if its lower bound
/// is after its upper one.
@available(iOS 16.2, *)
private func timerRange(_ state: PostMealAttributes.ContentState) -> ClosedRange<Date> {
  min(state.startedAt, state.endsAt)...state.endsAt
}

/// The timer glyph on its accent ground, shared by the lock-screen card and the
/// Dynamic Island's expanded leading region.
@available(iOS 16.2, *)
private func timerBadge(size: CGFloat, corner: CGFloat, glyph: CGFloat, tones: ActivityTones) -> some View {
  ZStack {
    RoundedRectangle(cornerRadius: corner, style: .continuous)
      .fill(tones.accent.opacity(0.18))
    Image(systemName: "timer")
      .font(.system(size: glyph, weight: .semibold))
      .foregroundColor(tones.accent)
  }
  .frame(width: size, height: size)
}

/// The last logged reading, as a pill. Value + unit are always printed together;
/// the pill only groups them, it says nothing about them.
@available(iOS 16.2, *)
private func readingPill(_ reading: String, unit: String, tones: ActivityTones) -> some View {
  HStack(alignment: .firstTextBaseline, spacing: 4) {
    Text(reading)
      .font(.system(size: 14, weight: .bold, design: .rounded))
      .monospacedDigit()
      .lineLimit(1)
      .foregroundColor(tones.ink)
    Text(unit)
      .font(.system(size: 10, weight: .medium))
      .lineLimit(1)
      .foregroundColor(tones.muted)
  }
  .padding(.horizontal, 9)
  .padding(.vertical, 5)
  .background {
    Capsule(style: .continuous)
      .fill(tones.ink.opacity(0.06))
  }
  .overlay {
    Capsule(style: .continuous)
      .strokeBorder(tones.ink.opacity(0.10), lineWidth: 1)
  }
}

@available(iOS 16.2, *)
struct PostMealActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PostMealAttributes.self) { context in
      // Lock screen / banner
      HStack(spacing: 12) {
        timerBadge(size: 38, corner: 12, glyph: 17, tones: .card)

        VStack(alignment: .leading, spacing: 1) {
          Text(context.attributes.title)
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(ActivityTones.card.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
          // Capped, not fixed: a timer Text asks for the widest string it could
          // ever show, and unchecked it would crowd the reading pill out of the
          // row. The cap still fits "1:59:59" at this size. Bounded to
          // startedAt...endsAt (rather than the open-ended `.timer` style) so it
          // freezes at 0:00 once due, instead of counting up past it.
          Text(timerInterval: timerRange(context.state), countsDown: true)
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: 96, alignment: .leading)
            .foregroundColor(context.isStale ? ActivityTones.card.muted : ActivityTones.card.accent)
        }

        Spacer(minLength: 8)

        if let reading = context.state.lastReading {
          readingPill(reading, unit: context.state.unitLabel, tones: .card)
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      // Fill the card BEFORE the link is attached. `widgetURL` makes the view
      // it is applied to the tap target, and this HStack is content-sized in
      // height: without this the padding and any height the system hands the
      // activity beyond the content were dead space, so a tap near the top or
      // bottom edge did nothing while a tap on the timer worked. That is the
      // "sometimes it opens, sometimes it doesn't" device QA reported.
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      // Tapping the card opens the post-meal reading sheet (2.3.0's K2-B) -
      // the same target the post-meal notification routes to, so the countdown
      // ends in the same place however the user gets there. This card had no
      // link at all before, which made the one surface showing the timer the
      // one surface that could not act on it.
      .widgetURL(DeepLinks.postMeal2h)
      .activityBackgroundTint(WidgetPalette.background)
      .activitySystemActionForegroundColor(ActivityTones.card.accent)
      // Once the countdown has actually elapsed (staleDate passed - see the
      // module's `start`), the whole card fades: the same "done" look everywhere
      // this activity renders, with no new copy needed.
      .opacity(context.isStale ? 0.55 : 1)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          timerBadge(size: 30, corner: 10, glyph: 14, tones: .island)
            .opacity(context.isStale ? 0.55 : 1)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(ActivityTones.island.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .opacity(context.isStale ? 0.55 : 1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          // 64pt only fits "59:59"; a fresh two-hour timer reads "1:59:59" and
          // was losing its tail. 72pt covers that, the scale factor covers the
          // rest. Bounded to startedAt...endsAt so it freezes at 0:00 instead of
          // counting up past it.
          Text(timerInterval: timerRange(context.state), countsDown: true)
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.trailing)
            .frame(minWidth: 72, alignment: .trailing)
            .foregroundColor(context.isStale ? ActivityTones.island.muted : ActivityTones.island.accent)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if let reading = context.state.lastReading {
            HStack(spacing: 0) {
              readingPill(reading, unit: context.state.unitLabel, tones: .island)
              Spacer(minLength: 0)
            }
            .padding(.top, 2)
            .opacity(context.isStale ? 0.55 : 1)
          }
        }
      } compactLeading: {
        Image(systemName: "timer")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(context.isStale ? ActivityTones.island.muted : ActivityTones.island.accent)
      } compactTrailing: {
        // The compact region is tight, so this stays the narrowest box that can
        // still print "1:59:59" - and scales rather than clips if it cannot.
        // Bounded to startedAt...endsAt, same reasoning as the two Text views
        // above.
        Text(timerInterval: timerRange(context.state), countsDown: true)
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 54)
          .foregroundColor(context.isStale ? ActivityTones.island.muted : ActivityTones.island.accent)
      } minimal: {
        Image(systemName: "timer")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(context.isStale ? ActivityTones.island.muted : ActivityTones.island.accent)
      }
      // Same destination as the lock-screen card's own widgetURL above: the
      // expanded island carries it here, next to keylineTint, because that is
      // where the modifier applies to the whole Dynamic Island presentation
      // rather than to one region of it.
      .widgetURL(DeepLinks.postMeal2h)
      // The hairline around the island while the activity is live: the brand
      // cyan, so the pill reads as ours at a glance.
      .keylineTint(ActivityTones.island.accent)
    }
  }
}
