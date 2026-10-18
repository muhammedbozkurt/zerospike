import SwiftUI
import WidgetKit

// zerospike home-screen widget: the last logged reading and the time left on the
// next reminder, at a glance. Both come from the shared App Group snapshot the
// app writes; the widget computes nothing and interprets nothing.
//
// Colour follows the app's one glucose language, and is never the only signal:
// the value and its unit are always printed beside it.

// Not `private`: SmallWidgets.swift colours its own reading against the same
// ramp, and a second copy of the band logic is exactly how the two tiles would
// end up disagreeing about the same number.
enum GlucoseColor {
  static let low = WidgetPalette.low
  static let target = WidgetPalette.target
  static let high = WidgetPalette.high
  static let wellAbove = WidgetPalette.wellAbove
  static let veryHigh = WidgetPalette.veryHigh
  static let accent = WidgetPalette.accent
  static let ink = WidgetPalette.ink
  static let muted = WidgetPalette.muted

  /// Colours a reading against the PROFILE's own band (mg/dL) when the snapshot
  /// carries one, falling back to the population defaults + the fixed clinical
  /// ceiling for older snapshots. It is a glance, not a classification.
  ///
  /// The step above the band mirrors lib/glucose.ts classifyGlucose: up to
  /// 1.25x the band's top is the yellow "above" step, past that the amber
  /// "well above" step, so the widget shows the same five-colour ramp the app
  /// and the report do.
  static func forReading(_ mgdl: Double, band: LiveData.Band?) -> Color {
    let hypoMgdl = band?.hypo ?? 70
    let highMgdl = band?.high ?? 180
    let veryHighMgdl = band?.veryHigh ?? 250
    if mgdl < hypoMgdl { return low }
    if mgdl >= veryHighMgdl { return veryHigh }
    if mgdl <= highMgdl { return target }
    if mgdl <= highMgdl * 1.25 { return high }
    return wellAbove
  }
}

/// The widget's ground.
///
/// Home-screen families get the brand wash. The lock-screen accessory families
/// get NO ground at all. iOS renders them in its own vibrant material and drops
/// any colour we set, so a brand fill can only ever show up as flat grey - and
/// `AccessoryWidgetBackground()` makes that worse, printing a heavy grey tray
/// behind the text in the gallery and on the lock screen. Bare vibrant
/// text/glyphs on the wallpaper is what this family is meant to look like.
private struct WidgetGround: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch family {
    case .accessoryRectangular, .accessoryInline, .accessoryCircular:
      Color.clear
    default:
      WidgetPalette.background
    }
  }
}

struct ZerospikeEntry: TimelineEntry {
  let date: Date
  let data: LiveData?
}

extension LiveData {
  /// Gallery preview / redaction placeholder ONLY: a representative reading so
  /// the widget gallery never shows an empty tile. Never rendered as the user's
  /// own data; the timeline always reads the real snapshot.
  static let placeholderSample = LiveData(
    updatedAt: 0,
    unit: "mmol",
    lang: nil,
    lastGlucoseMgdl: 101,
    lastGlucoseDisplay: "5.6",
    lastGlucoseAt: nil,
    avgGlucoseMgdl: 101,
    avgGlucoseDisplay: "5.6",
    avgWindowDays: 7,
    nextReminderAt: nil,
    nextReminderKind: nil,
    nextReminderLabel: nil,
    nextReminderMode: nil,
    postMealEndsAt: nil,
    usesInsulin: nil,
    usesOralMeds: nil,
    band: nil,
    labels: nil
  )
}

struct ZerospikeProvider: TimelineProvider {
  func placeholder(in context: Context) -> ZerospikeEntry {
    ZerospikeEntry(date: Date(), data: LiveDataStore.read() ?? .placeholderSample)
  }

  func getSnapshot(in context: Context, completion: @escaping (ZerospikeEntry) -> Void) {
    // In the gallery (isPreview) fall back to the sample so the preview is
    // never blank; on the home screen a missing snapshot stays honest (noData).
    let fallback: LiveData? = context.isPreview ? LiveData.placeholderSample : nil
    completion(ZerospikeEntry(date: Date(), data: LiveDataStore.read() ?? fallback))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ZerospikeEntry>) -> Void) {
    let now = Date()
    let data = LiveDataStore.read()
    // Minute precision is enough for a countdown, and refreshing every minute
    // for an hour keeps the widget honest without burning the refresh budget.
    var entries: [ZerospikeEntry] = []
    for minute in 0..<60 {
      let date = Calendar.current.date(byAdding: .minute, value: minute, to: now) ?? now
      entries.append(ZerospikeEntry(date: date, data: data))
    }
    // The countdown pill's `Text(due, style: .timer)` has no "stop": once `due`
    // passes it counts up, and the pill only disappears once an entry with
    // `date >= due` is selected (the `due > entry.date` guard in the view). On
    // the minute-boundary entries above that could be up to 60s after `due`. An
    // entry landing on `due` itself closes that window immediately.
    if let due = data?.nextReminderDate, due > now, due < (entries.last?.date ?? now) {
      entries.append(ZerospikeEntry(date: due, data: data))
      entries.sort { $0.date < $1.date }
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

struct ZerospikeWidgetView: View {
  @Environment(\.widgetFamily) private var family
  var entry: ZerospikeEntry

  // The widget pins the rolling AVERAGE (a persistent number), falling back to the
  // last reading only for a pre-R10 snapshot that carries no average yet.
  private var reading: String {
    entry.data?.displayAverage ?? entry.data?.displayGlucose ?? "-"
  }

  private var readingMgdl: Double? {
    entry.data?.avgGlucoseMgdl ?? entry.data?.lastGlucoseMgdl
  }

  private var readingLabel: String {
    entry.data?.labels?.avgGlucose ?? entry.data?.labels?.lastReading ?? ""
  }

  private var readingColor: Color {
    guard let mgdl = readingMgdl else { return GlucoseColor.muted }
    return GlucoseColor.forReading(mgdl, band: entry.data?.band)
  }

  /// The line under the value: the averaging window, or the honest empty state.
  private var metaLine: String {
    if readingMgdl == nil { return entry.data?.labels?.noData ?? "" }
    return entry.data?.labels?.avgWindow ?? ""
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryInline:
        // Lock-screen inline: one short line the OS tints for us.
        inlineView
      case .accessoryRectangular:
        // Lock-screen rectangular: the next reminder by name, or a running
        // post-meal countdown, over the pinned reading.
        rectangularView
      case .accessoryCircular:
        // Lock-screen circular: one number, no room for anything else.
        circularView
      case .systemMedium:
        mediumView
      default:
        smallView
      }
    }
    .widgetURL(tapURL)
    // Mirrors the app's OWN in-app language, not the device's system
    // language: a user reading the app in Arabic sees the widget flip too,
    // even on an English device, and vice versa. No `lang` (older snapshot)
    // leaves the environment untouched, i.e. the device's own direction.
    .applyingLayoutDirection(layoutDirection(forLang: entry.data?.lang))
  }

  /// Every family taps into the dashboard's glucose quick-add sheet (2.3.0's
  /// K2-B). A widget is a logging shortcut, and the home-screen tiles used to
  /// be the one surface that only opened the app - so the same widget behaved
  /// differently depending on where it was placed, and the shortest path to
  /// recording a reading was the one place that did not offer it. The link is
  /// DeepLinks.addGlucose, the same constant QuickAdd's glucose shortcut uses,
  /// answered by app/(tabs)/index.tsx's `sheet` param reader. The sheet is
  /// dismissable and the dashboard sits behind it, so nothing is lost for
  /// someone who only wanted the app open.
  private var tapURL: URL? {
    // HOME-SCREEN families always open the glucose quick-add sheet - 2.3.0's
    // K2-B decision, unchanged: a widget is a logging shortcut, and the home
    // tiles were the one surface that only opened the app, so the same widget
    // behaved differently depending on where it was placed.
    //
    // The LOCK-SCREEN accessory families are the exception, and only because
    // they lead with different content: a tile showing a running countdown or a
    // named reminder should land where the user was already looking, not on a
    // logging sheet they did not ask for. That split is deliberate rather than
    // an inconsistency (see docs/plan-2.3.0.md 16.3).
    switch family {
    case .accessoryInline, .accessoryRectangular, .accessoryCircular:
      switch leadState {
      case .postMeal:
        return DeepLinks.postMeal2h
      case .reminder:
        return DeepLinks.reminders
      case .reading:
        return DeepLinks.addGlucose
      }
    default:
      return DeepLinks.addGlucose
    }
  }

  /// What the lock-screen families lead with, decided once so the three of them
  /// (and the tap target) can never disagree about it.
  ///
  /// A RUNNING post-meal countdown wins even when a daily reminder is due
  /// sooner: a timer already ticking is what someone glancing at their lock
  /// screen came to check, and it is the only one of the three that is
  /// finishing on its own.
  private enum LeadState { case postMeal, reminder, reading }

  private var leadState: LeadState {
    if let end = entry.data?.postMealEndsDate, end > entry.date { return .postMeal }
    // A due reminder leads whether or not the snapshot names it. A snapshot
    // written by an older app build carries no `nextReminderLabel`, and
    // requiring one here silently dropped the countdown those users had been
    // seeing since 2.2.0 - the accessory views fall back to the plain countdown
    // for a nameless row instead.
    if let due = entry.data?.nextReminderDate, due > entry.date { return .reminder }
    return .reading
  }

  /// Whether the snapshot actually names the next reminder. False on a
  /// pre-K3 snapshot, which is what the nameless fallbacks below key off.
  private var hasReminderName: Bool {
    entry.data?.nextReminderLabel?.isEmpty == false
  }

  /// Home-screen small: the pinned value, its context line, and the countdown
  /// pill pinned to the bottom.
  private var smallView: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(readingLabel)
        .font(.system(size: 10, weight: .bold))
        .foregroundColor(GlucoseColor.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)

      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .foregroundColor(readingColor)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(GlucoseColor.muted)
      }
      // Locked LTR: a value+unit pair (e.g. "110 mg/dL") must keep the number
      // before the unit even when the rest of the widget mirrors for RTL.
      .environment(\.layoutDirection, .leftToRight)
      .padding(.top, 1)

      Text(metaLine)
        .font(.system(size: 11))
        .foregroundColor(GlucoseColor.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)

      Spacer(minLength: 6)

      if let due = entry.data?.nextReminderDate, due > entry.date {
        // The reminder's own NAME above the countdown: a bare timer said only
        // that SOMETHING was due, which on a profile with four reminders is not
        // the same as knowing which. One line, clipped rather than wrapped.
        if let name = entry.data?.nextReminderLabel, !name.isEmpty {
          reminderNameLine(name, size: 10)
        }
        countdownPill(due: due, size: 14)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(12)
  }

  /// The next reminder's name, prefixed with the glyph for how it will actually
  /// be delivered (alarm vs notification, from the app's own decision - see
  /// nextReminderGlyph). Home-screen only: the accessory families draw their own.
  private func reminderNameLine(_ name: String, size: CGFloat) -> some View {
    HStack(spacing: 3) {
      Image(systemName: entry.data?.nextReminderGlyph ?? "bell")
        .font(.system(size: size - 1, weight: .semibold))
      Text(name)
        .font(.system(size: size, weight: .bold))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .foregroundColor(GlucoseColor.muted)
  }

  /// Home-screen medium: the pinned average on the left, the latest reading and
  /// the reminder countdown on the right, split by a hairline. Same numbers, one
  /// wider glance.
  private var mediumView: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 0) {
        Text(readingLabel)
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(GlucoseColor.muted)
          .lineLimit(1)
          .minimumScaleFactor(0.8)

        HStack(alignment: .firstTextBaseline, spacing: 5) {
          Text(reading)
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundColor(readingColor)
          Text(entry.data?.unitLabel ?? "")
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(GlucoseColor.muted)
        }
        // Locked LTR, same reasoning as smallView's reading+unit pair above.
        .environment(\.layoutDirection, .leftToRight)
        .padding(.top, 2)

        Text(metaLine)
          .font(.system(size: 11))
          .foregroundColor(GlucoseColor.muted)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
          .fixedSize(horizontal: false, vertical: true)

        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      Rectangle()
        .fill(Color.white.opacity(0.08))
        .frame(width: 1)
        .frame(maxHeight: .infinity)

      VStack(alignment: .leading, spacing: 10) {
        if let lastMgdl = entry.data?.lastGlucoseMgdl,
           let last = entry.data?.displayGlucose {
          VStack(alignment: .leading, spacing: 1) {
            Text(entry.data?.labels?.lastReading ?? "")
              .font(.system(size: 9, weight: .bold))
              .foregroundColor(GlucoseColor.muted)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
              Text(last)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundColor(GlucoseColor.forReading(lastMgdl, band: entry.data?.band))
              Text(entry.data?.unitLabel ?? "")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(GlucoseColor.muted)
            }
            // Locked LTR, same reasoning as the pinned reading+unit pair above.
            .environment(\.layoutDirection, .leftToRight)
          }
        }

        Spacer(minLength: 0)

        if let due = entry.data?.nextReminderDate, due > entry.date {
          VStack(alignment: .leading, spacing: 3) {
            // The row's own name when the snapshot carries one, falling back to
            // the generic "next reminder" heading for an older snapshot.
            if let name = entry.data?.nextReminderLabel, !name.isEmpty {
              reminderNameLine(name, size: 9)
            } else {
              Text(entry.data?.labels?.nextReminder ?? "")
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(GlucoseColor.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            countdownPill(due: due, size: 15)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(12)
  }

  /// The reminder countdown, in the accent, on its own tinted ground so it reads
  /// as a separate block from the reading above it. Tabular digits, so the pill
  /// does not twitch as the timer ticks.
  ///
  /// The explicit box around the timer is load-bearing. `Text(_:style: .timer)`
  /// asks for the widest string it could EVER show, so left to itself it blows
  /// the pill past the widget's edge and the countdown gets clipped mid-digit
  /// ("1:59:.."). Boxing it to a "0:00:00" measure keeps the pill hugging its
  /// content, and the scale factor absorbs the rare longer countdown.
  private func countdownPill(due: Date, size: CGFloat) -> some View {
    HStack(alignment: .center, spacing: 5) {
      Image(systemName: "timer")
        .font(.system(size: size - 4, weight: .semibold))
        .foregroundColor(GlucoseColor.accent)
      Text(due, style: .timer)
        .font(.system(size: size, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .multilineTextAlignment(.center)
        .foregroundColor(GlucoseColor.accent)
        .frame(width: max(56.0, size * 4.0), alignment: .center)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .background {
      Capsule(style: .continuous)
        .fill(GlucoseColor.accent.opacity(0.14))
    }
    .overlay {
      Capsule(style: .continuous)
        .strokeBorder(GlucoseColor.accent.opacity(0.28), lineWidth: 1)
    }
  }

  /// Lock-screen rectangular accessory: the pinned reading (+ unit) and the
  /// countdown to the next reminder.
  ///
  /// Deliberately NO brand colours and NO ground here. iOS renders this family in
  /// its vibrant material: it takes the LUMINANCE of the content and re-renders it
  /// in the system material, so an explicit cyan or mint is flattened to the same
  /// grey as everything else. What the OS does honour is the hierarchy, so the
  /// primary line stays `.primary` and everything under it uses `.secondary` and
  /// lets the material separate them. `AccessoryWidgetBackground()` stays out on
  /// purpose - see WidgetGround above: on this exact family it prints a heavy grey
  /// tray behind the text instead of the vibrant material the row is meant to sit
  /// in, which hurts legibility rather than helping it.
  ///
  /// The reading also carries `.widgetAccentable()`: when the user picks a Lock
  /// Screen tint, only marked content takes it, so the value keeps standing apart
  /// from the secondary line even in that mode instead of the two flattening to
  /// the same tint.
  private var rectangularView: some View {
    VStack(alignment: .leading, spacing: 2) {
      switch leadState {
      case .postMeal:
        // A running countdown takes the top line, whatever else is due.
        if let end = entry.data?.postMealEndsDate {
          accessoryLead(
            glyph: "timer",
            title: entry.data?.labels?.nextReminder ?? "",
            trailing: { boxedTimer(end) }
          )
        }
      case .reminder:
        if let due = entry.data?.nextReminderDate {
          accessoryLead(
            // A pre-K3 snapshot names nothing, so the lead falls back to the
            // generic heading the app already ships - and to the COUNTDOWN it
            // used to draw, which is the behaviour those users have had since
            // 2.2.0 and must not lose just because they have not relaunched.
            glyph: hasReminderName ? (entry.data?.nextReminderGlyph ?? "bell") : "timer",
            title: hasReminderName
              ? (entry.data?.nextReminderLabel ?? "")
              : (entry.data?.labels?.nextReminder ?? ""),
            trailing: {
              if hasReminderName {
                // A fixed clock time, not a countdown: the row's own HH:MM is
                // what the app shows for it, and a ticking timer next to a name
                // reads as "this is running" when it is merely scheduled.
                Text(due, style: .time)
                  .font(.system(size: 12, weight: .semibold))
                  .monospacedDigit()
                  .lineLimit(1)
              } else {
                boxedTimer(due)
              }
            }
          )
        }
      case .reading:
        EmptyView()
      }

      // The pinned reading, always: on the lead lines above it is the second
      // line, and with nothing upcoming it is the whole tile.
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .privacySensitive()
          .font(.system(size: leadState == .reading ? 21 : 15, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .foregroundStyle(leadState == .reading ? .primary : .secondary)
          .widgetAccentable(leadState == .reading)
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
      }
      // Locked LTR, same reasoning as the home-screen reading+unit pairs above.
      .environment(\.layoutDirection, .leftToRight)

      if leadState == .reading {
        Text(readingLabel)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .padding(.vertical, 4)
  }

  /// One lead row: mechanism glyph, the reminder's own name, and its time. The
  /// name is `.primary` and accentable so a Lock Screen tint separates it from
  /// the reading below instead of flattening the two together.
  private func accessoryLead<T: View>(
    glyph: String,
    title: String,
    @ViewBuilder trailing: () -> T
  ) -> some View {
    HStack(alignment: .center, spacing: 4) {
      Image(systemName: glyph)
        .font(.system(size: 10, weight: .semibold))
      Text(title)
        .font(.system(size: 12, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Spacer(minLength: 2)
      trailing()
    }
    .foregroundStyle(.primary)
    .widgetAccentable()
  }

  /// Same greedy-width trap as the home-screen pill: `Text(_:style: .timer)`
  /// asks for the widest string it could ever show, so box it or the narrow
  /// accessory frame clips it mid-digit.
  private func boxedTimer(_ due: Date) -> some View {
    Text(due, style: .timer)
      .font(.system(size: 12, weight: .semibold))
      .monospacedDigit()
      .lineLimit(1)
      .minimumScaleFactor(0.6)
      .frame(width: 52, alignment: .trailing)
  }

  /// Lock-screen inline accessory: a single short string (OS-constrained to one
  /// line + an optional glyph), so just the pinned reading and its unit.
  /// `.widgetAccentable()` for the same reason as the rectangular family's
  /// reading: it picks up a user-chosen Lock Screen tint instead of the default
  /// untinted rendering.
  private var inlineView: some View {
    // One line, and the OS decides how much of it survives - so the most
    // specific thing this user has is what goes in it, and the app name is the
    // last resort rather than the default.
    Group {
      switch leadState {
      case .postMeal:
        if let end = entry.data?.postMealEndsDate {
          Label { Text(end, style: .timer) } icon: { Image(systemName: "timer") }
        }
      case .reminder:
        if let due = entry.data?.nextReminderDate {
          if hasReminderName {
            Label {
              Text("\(entry.data?.nextReminderLabel ?? "") \(due, style: .time)")
            } icon: {
              Image(systemName: entry.data?.nextReminderGlyph ?? "bell")
            }
          } else {
            // Pre-K3 snapshot: the countdown alone, as before.
            Label { Text(due, style: .timer) } icon: { Image(systemName: "timer") }
          }
        }
      case .reading:
        if readingMgdl != nil {
          Text("\(reading) \(entry.data?.unitLabel ?? "")")
            .privacySensitive()
        } else {
          // Nothing logged and nothing due: the gallery preview and a brand-new
          // install both land here. The app's own name, so the row still says
          // WHOSE widget it is instead of showing a bare dash.
          Text("zerospike")
        }
      }
    }
    .widgetAccentable()
  }

  /// Lock-screen circular accessory: one number in a ring, with no room for a
  /// label. The running countdown's remaining MINUTES when there is one (the
  /// thing that is actively changing), otherwise the pinned reading - unitless,
  /// because the ring cannot fit "mg/dL" and the glyph under it already says
  /// what kind of number this is.
  private var circularView: some View {
    VStack(spacing: 0) {
      if let end = entry.data?.postMealEndsDate, end > entry.date {
        Text(end, style: .timer)
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .frame(width: 46)
        Image(systemName: "timer")
          .font(.system(size: 9, weight: .semibold))
      } else {
        Text(reading)
          .font(.system(size: 19, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          // A glucose value is health data (see the privacy note on
          // ZerospikeWidget below); the timer branch above is a schedule and
          // stays legible while locked.
          .privacySensitive()
        Image(systemName: "drop.fill")
          .font(.system(size: 9, weight: .semibold))
      }
    }
    .widgetAccentable()
  }
}

@main
struct ZerospikeWidgetBundle: WidgetBundle {
  var body: some Widget {
    // The two originals stay FIRST and keep their kinds, families and looks.
    // A kind string is the identity of a widget already sitting on someone's
    // home screen: change it and their tile silently becomes a blank
    // placeholder, so these two lines are the ones never to touch.
    ZerospikeWidget()
    ZerospikeQuickAddWidget()
    // 2.3.1: the single-purpose tiles, small enough for the lock screen too
    // (see SmallWidgets.swift).
    ZerospikeReadingWidget()
    ZerospikeLogGlucoseWidget()
    ZerospikeLogMealWidget()
    ZerospikeLogInsulinWidget()
    ZerospikeTimerWidget()
    if #available(iOS 16.2, *) {
      PostMealActivityWidget()
    }
    // Control Centre / Lock Screen control slots / Action button. ControlWidget
    // does not exist before iOS 18, so the whole block is behind availability
    // and the deployment target stays 16.4 (see Controls.swift).
    if #available(iOS 18.0, *) {
      ZerospikeLogGlucoseControl()
      ZerospikeStartTimerControl()
    }
  }
}

struct ZerospikeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeWidget", provider: ZerospikeProvider()) { entry in
      if #available(iOS 17.0, *) {
        ZerospikeWidgetView(entry: entry)
          .containerBackground(for: .widget) { WidgetGround() }
      } else {
        ZerospikeWidgetView(entry: entry)
          .background { WidgetGround() }
      }
    }
    // Gallery-only strings, and the ONLY strings this extension owns. The widget
    // EXTENSION bundle has no localization catalog: @bacons/apple-targets syncs
    // targets/widget as a plain folder and never registers an .lproj, and the
    // app's own locales come from a separate Expo mechanism that only touches the
    // main app target. So these stay English for every user, and must at least be
    // legible instead of the brand name repeated twice. Everything INSIDE the
    // tiles is localized: those labels ride in on the app's snapshot.
    // Journal language only - this widget shows what was logged, nothing else.
    .configurationDisplayName("Glucose summary")
    .description("Your glucose average, your next reminder, and any running post-meal timer.")
    // PRIVACY. The glucose VALUE is marked privacySensitive wherever it is
    // drawn, so iOS redacts it while the device is locked unless the user has
    // opted into showing sensitive content. That is the right default for a
    // health measurement, and it is Apple's own guidance for this data class.
    //
    // The reminder's NAME and TIME are deliberately NOT marked. They are a
    // schedule, not a measurement: redacting them would leave a lock-screen
    // tile whose entire purpose - "your next reminder is at 08:00" - is blanked
    // out exactly when it is most useful, and it discloses nothing about the
    // user's readings. Someone who wants the number visible too can allow it in
    // Settings > Face ID & Passcode > Show Sensitive Content.
    // Home-screen + lock-screen (iOS 16+ accessory) families. The deployment
    // target is 16.4, so the accessory cases are always available here.
    .supportedFamilies([
      .systemSmall,
      .systemMedium,
      .accessoryRectangular,
      .accessoryInline,
      .accessoryCircular,
    ])
    // iOS 18 tinted/clear home-screen modes must not strip the brand ground;
    // the glucose colours are calibrated against it.
    .containerBackgroundRemovable(false)
  }
}
