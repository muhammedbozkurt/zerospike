import SwiftUI
import WidgetKit

// The single-purpose widgets: one reading readout, three logging shortcuts and
// the post-meal countdown, each small enough to sit on the lock screen as well
// as the home screen. index.swift keeps the original glucose-summary widget and
// the bundle; everything added in 2.3.1 lives here so neither file has to be
// read in full to change the other.
//
// Scope is the same as every other glanceable surface: these tiles show what the
// user already logged and open the app's own screens. Nothing here measures,
// interprets or advises, and nothing here writes: even the countdown tile only
// OPENS the start surface, because the duration picker and the "one is already
// running" confirmation live in the app (see DeepLinks.startPostMeal).
//
// Every string drawn inside a tile comes pre-localized in the shared snapshot
// (lib/services/liveData.ts writes nine languages' worth). The only English in
// this file is the widget gallery's own configurationDisplayName/description,
// which the extension bundle cannot localize at all - it carries no
// localization catalog, exactly as documented on ZerospikeWidget in index.swift.

private enum SmallPalette {
  // Same sRGB components as lib/theme/tokens.ts, matching QuickAdd.swift tile
  // for tile so the two widgets cannot drift apart by a shade.
  static let ink = WidgetPalette.ink
  static let muted = WidgetPalette.muted
  static let glucose = WidgetPalette.accent
  static let meal = WidgetPalette.target
  static let injection = WidgetPalette.violet
  /// The countdown's hue. Amber is the one warm colour left once cyan, mint and
  /// violet are taken; the timer tile prints no reading, so it cannot be read as
  /// a classification of one.
  static let countdown = WidgetPalette.warning

  static let tileFillOpacity = 0.16
  static let tileStrokeOpacity = 0.34
  static let badgeFillOpacity = 0.20
}

/// The ground under a small widget, following the same rule WidgetGround sets in
/// index.swift: the brand wash on the home screen, and NOTHING on the lock
/// screen, where iOS renders accessory families in its own vibrant material and
/// drops any colour we set.
private struct SmallGround: View {
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

/// Wraps a widget body in that ground, on both sides of the iOS 17 container
/// background API - the same two-armed shape ZerospikeWidget already uses.
@ViewBuilder
private func grounded<Content: View>(_ content: Content) -> some View {
  if #available(iOS 17.0, *) {
    content.containerBackground(for: .widget) { SmallGround() }
  } else {
    content.background { SmallGround() }
  }
}

// MARK: - Shared timeline

struct SmallEntry: TimelineEntry {
  let date: Date
  let data: LiveData?
}

/// For the tiles whose content does not change on its own (the three logging
/// shortcuts). The app reloads every timeline whenever it rewrites the snapshot,
/// so a label or a visibility flag still updates the moment it changes.
struct SmallStaticProvider: TimelineProvider {
  private func currentEntry(preview: Bool = false) -> SmallEntry {
    let fallback: LiveData? = preview ? LiveData.placeholderSample : nil
    return SmallEntry(date: Date(), data: LiveDataStore.read() ?? fallback)
  }

  func placeholder(in context: Context) -> SmallEntry {
    currentEntry(preview: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (SmallEntry) -> Void) {
    completion(currentEntry(preview: context.isPreview))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SmallEntry>) -> Void) {
    completion(Timeline(entries: [currentEntry()], policy: .never))
  }
}

/// For the tiles that go stale on the clock alone: the reading's "how long ago"
/// line and the countdown's running/idle split. Minute precision for an hour,
/// the same budget ZerospikeProvider spends, plus one entry landing exactly on
/// the moment a running countdown ends so the tile flips there instead of up to
/// a minute late.
struct SmallTickingProvider: TimelineProvider {
  func placeholder(in context: Context) -> SmallEntry {
    SmallEntry(date: Date(), data: LiveDataStore.read() ?? .placeholderSample)
  }

  func getSnapshot(in context: Context, completion: @escaping (SmallEntry) -> Void) {
    let fallback: LiveData? = context.isPreview ? LiveData.placeholderSample : nil
    completion(SmallEntry(date: Date(), data: LiveDataStore.read() ?? fallback))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SmallEntry>) -> Void) {
    let now = Date()
    let data = LiveDataStore.read()
    var entries: [SmallEntry] = []
    for minute in 0..<60 {
      let date = Calendar.current.date(byAdding: .minute, value: minute, to: now) ?? now
      entries.append(SmallEntry(date: date, data: data))
    }
    if let end = data?.postMealEndsDate, end > now, end < (entries.last?.date ?? now) {
      entries.append(SmallEntry(date: end, data: data))
      entries.sort { $0.date < $1.date }
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

/// "6 sa 23 dk önce", hand-composed from the app's OWN strings.
///
/// `Text(date, style: .relative)` is localized to the DEVICE's system language,
/// not the app's in-app one, so a Turkish user on an English phone would read
/// their widget in English. targets/watch/ContentView.swift composes the same
/// string the same way; keep the two in step.
///
/// `nil` for a snapshot with no reading, or one written before these labels
/// existed - the caller then simply omits the line rather than inventing one.
func smallElapsedLabel(_ data: LiveData?, now: Date) -> String? {
  guard let date = data?.lastReadingDate else { return nil }
  guard
    let labels = data?.labels,
    let hourShort = labels.hourShort,
    let minuteShort = labels.minuteShort,
    let template = labels.agoTemplate
  else { return nil }
  let totalMinutes = max(0, Int(now.timeIntervalSince(date) / 60))
  let hours = totalMinutes / 60
  let minutes = totalMinutes % 60
  let duration = hours > 0
    ? "\(hours) \(hourShort) \(minutes) \(minuteShort)"
    : "\(minutes) \(minuteShort)"
  return template.replacingOccurrences(of: "{{t}}", with: duration)
}

// MARK: - Logging shortcuts

/// One logging shortcut, fully resolved from the snapshot before it is drawn.
struct SmallAction {
  let icon: String
  let tint: Color
  let label: String
  let url: URL
  /// Whether tapping this tile leads to a form that RECORDS something. Drives
  /// the little "+", which is a promise: a tile that only brings the app
  /// forward (the neutral state below) must not wear one.
  let addsEntry: Bool
}

/// The brand-only fallback: a tile that says whose app it belongs to and opens
/// it, with no claim about what the user will find inside. Used wherever a
/// specific label would be wrong - most importantly for a profile that does not
/// use insulin (see `smallInjectionAction`).
private func smallOpenAppAction(_ tint: Color) -> SmallAction {
  SmallAction(
    icon: "arrow.up.forward.app.fill",
    tint: tint,
    // The app's own name, not a translated phrase: this extension owns no
    // translations, and a brand name reads the same in all nine languages.
    label: "zerospike",
    url: DeepLinks.dashboard,
    addsEntry: false
  )
}

private func smallGlucoseAction(_ data: LiveData?) -> SmallAction {
  SmallAction(
    icon: "drop.fill",
    tint: SmallPalette.glucose,
    label: data?.labels?.addGlucose ?? "zerospike",
    url: DeepLinks.addGlucose,
    addsEntry: true
  )
}

private func smallMealAction(_ data: LiveData?) -> SmallAction {
  SmallAction(
    icon: "fork.knife",
    tint: SmallPalette.meal,
    label: data?.labels?.addMeal ?? "zerospike",
    url: DeepLinks.addMeal,
    addsEntry: true
  )
}

/// The injection shortcut, or a neutral open-the-app tile.
///
/// A profile with `insulin_mode = "none"` has every in-app injection surface
/// hidden. Its home screen must not be the one place that contradicts that, and
/// the tile must not leak the WORD either - so it does not merely lose its link,
/// it loses the syringe and the label too and falls back to the brand tile.
/// QuickAdd drops its injection tile outright for the same profile; this widget
/// cannot disappear once placed, so it goes neutral instead.
///
/// Only an explicit `false` does this. A snapshot written before the flag
/// existed - or none at all - keeps the injection shortcut, matching
/// QuickAddEntry's own default.
private func smallInjectionAction(_ data: LiveData?) -> SmallAction {
  if data?.usesInsulin == false {
    return smallOpenAppAction(SmallPalette.glucose)
  }
  return SmallAction(
    icon: "syringe.fill",
    tint: SmallPalette.injection,
    label: data?.labels?.addInjection ?? "zerospike",
    url: DeepLinks.addInjection,
    addsEntry: true
  )
}

/// A logging shortcut, drawn for whichever family it landed in.
struct SmallActionView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SmallEntry
  let action: SmallAction

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular:
        circularView
      case .accessoryInline:
        // One line, and the OS decides how much of it survives.
        Label { Text(action.label) } icon: { Image(systemName: action.icon) }
          .widgetAccentable()
      case .accessoryRectangular:
        rectangularView
      default:
        smallView
      }
    }
    .widgetURL(action.url)
    .applyingLayoutDirection(layoutDirection(forLang: entry.data?.lang))
  }

  /// Home-screen small: the identity tile QuickAdd already uses, at full bleed.
  private var smallView: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        ZStack {
          RoundedRectangle(cornerRadius: 13, style: .continuous)
            .fill(action.tint.opacity(SmallPalette.badgeFillOpacity))
          Image(systemName: action.icon)
            .font(.system(size: 18, weight: .semibold))
            .foregroundColor(action.tint)
        }
        .frame(width: 40, height: 40)

        Spacer(minLength: 0)

        if action.addsEntry {
          Image(systemName: "plus")
            .font(.system(size: 14, weight: .heavy))
            .foregroundColor(action.tint)
        }
      }

      Spacer(minLength: 8)

      Text(action.label)
        .font(.system(size: 15, weight: .semibold))
        .foregroundColor(SmallPalette.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.65)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background {
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .fill(action.tint.opacity(SmallPalette.tileFillOpacity))
    }
    .overlay {
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .strokeBorder(action.tint.opacity(SmallPalette.tileStrokeOpacity), lineWidth: 1)
    }
    .padding(4)
  }

  /// Lock-screen circular: the glyph alone, on the system's own tray.
  ///
  /// `AccessoryWidgetBackground()` is deliberately used HERE and nowhere else in
  /// this target. index.swift keeps it out of the readout families because on
  /// those it prints a heavy tray behind text that is meant to sit in the
  /// vibrant material. This tile is a BUTTON with one glyph in it, which is the
  /// case the tray exists for: without it a lone glyph on a busy wallpaper reads
  /// as decoration rather than as something to press.
  private var circularView: some View {
    ZStack {
      // NOT inside the accentable group below: a user-chosen Lock Screen tint
      // is meant to pick out the CONTENT, and tinting the tray with it flattens
      // the glyph back into its own background.
      AccessoryWidgetBackground()
      VStack(spacing: 1) {
        Image(systemName: action.icon)
          .font(.system(size: 17, weight: .semibold))
        if action.addsEntry {
          Image(systemName: "plus")
            .font(.system(size: 8, weight: .heavy))
        }
      }
      .widgetAccentable()
    }
  }

  /// Lock-screen rectangular: glyph, label, and the "+" that says this writes an
  /// entry. No brand colours - the OS re-renders this family in its material and
  /// would flatten them to grey anyway (see rectangularView in index.swift).
  private var rectangularView: some View {
    HStack(spacing: 6) {
      Image(systemName: action.icon)
        .font(.system(size: 15, weight: .semibold))
      Text(action.label)
        .font(.system(size: 14, weight: .semibold))
        .lineLimit(2)
        .minimumScaleFactor(0.7)
      Spacer(minLength: 2)
      if action.addsEntry {
        Image(systemName: "plus")
          .font(.system(size: 11, weight: .heavy))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .foregroundStyle(.primary)
    .widgetAccentable()
  }
}

// MARK: - Last reading

/// The last logged reading and how long ago it was.
///
/// This is the one place any surface in this target pins the LAST reading rather
/// than the rolling average: the summary widget in index.swift exists to show a
/// persistent number, and this one exists to answer "what did I last write
/// down". They deliberately disagree, which is why they are separate widgets
/// instead of one with a mode.
struct SmallReadingView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SmallEntry

  private var reading: String {
    entry.data?.displayGlucose ?? "-"
  }

  private var hasReading: Bool {
    entry.data?.lastGlucoseMgdl != nil || entry.data?.lastGlucoseDisplay != nil
  }

  private var readingColor: Color {
    guard let mgdl = entry.data?.lastGlucoseMgdl else { return SmallPalette.muted }
    return GlucoseColor.forReading(mgdl, band: entry.data?.band)
  }

  private var title: String {
    entry.data?.labels?.lastReading ?? "zerospike"
  }

  /// The line under the value: how long ago it was logged, or the app's own
  /// empty state. Never a guess - a snapshot with no reading says so.
  private var metaLine: String {
    if !hasReading { return entry.data?.labels?.noData ?? "" }
    return smallElapsedLabel(entry.data, now: entry.date) ?? ""
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular:
        circularView
      case .accessoryInline:
        inlineView
      case .accessoryRectangular:
        rectangularView
      default:
        smallView
      }
    }
    .widgetURL(DeepLinks.addGlucose)
    .applyingLayoutDirection(layoutDirection(forLang: entry.data?.lang))
  }

  private var smallView: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title)
        .font(.system(size: 10, weight: .bold))
        .foregroundColor(SmallPalette.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)

      Spacer(minLength: 4)

      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .font(.system(size: 38, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .foregroundColor(readingColor)
          .privacySensitive()
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(SmallPalette.muted)
      }
      // The value and its unit are one left-to-right pair in every language,
      // same as the summary widget's own reading line.
      .environment(\.layoutDirection, .leftToRight)

      Spacer(minLength: 4)

      Text(metaLine)
        .font(.system(size: 11, weight: .medium))
        .foregroundColor(SmallPalette.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  private var rectangularView: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
        .font(.system(size: 12, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .foregroundStyle(.primary)
        .widgetAccentable()

      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(reading)
          .font(.system(size: 21, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .privacySensitive()
        Text(entry.data?.unitLabel ?? "")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
      }
      .environment(\.layoutDirection, .leftToRight)

      Text(metaLine)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .padding(.vertical, 4)
  }

  private var inlineView: some View {
    Group {
      if hasReading {
        Label {
          Text("\(reading) \(entry.data?.unitLabel ?? "")")
        } icon: {
          Image(systemName: "drop.fill")
        }
        .privacySensitive()
      } else {
        // Nothing logged: the app's own name rather than a bare dash, so the
        // row still says whose widget it is.
        Text("zerospike")
      }
    }
    .widgetAccentable()
  }

  private var circularView: some View {
    VStack(spacing: 0) {
      Text(reading)
        .font(.system(size: 19, weight: .bold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        // A glucose value is health data: iOS redacts it on a locked device
        // unless the user has allowed sensitive content, the same policy every
        // reading on every family in this target follows.
        .privacySensitive()
      Image(systemName: "drop.fill")
        .font(.system(size: 9, weight: .semibold))
    }
    .widgetAccentable()
  }
}

// MARK: - Post-meal countdown

/// The post-meal countdown: what is left when one is running, and the way to
/// start one when none is.
///
/// The idle tile does NOT arm a timer. It opens the app's start surface, because
/// the duration picker and the "one is already running" confirmation live there
/// - a widget that started a window silently would skip both.
struct SmallTimerView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SmallEntry

  /// The end of a countdown that is still running AT THIS ENTRY'S date. `nil`
  /// once it has passed, which is what flips every family below back to idle.
  private var runningEnd: Date? {
    guard let end = entry.data?.postMealEndsDate, end > entry.date else { return nil }
    return end
  }

  private var title: String {
    if runningEnd != nil { return entry.data?.labels?.timerTitle ?? "zerospike" }
    // Null while `dashboard.startCountdown` is still untranslated (the app sends
    // null rather than a raw key, see lib/services/liveData.ts), so the tile
    // falls back to the brand name instead of printing an i18n key at someone.
    return entry.data?.labels?.startCountdown ?? "zerospike"
  }

  private var tapURL: URL {
    runningEnd != nil ? DeepLinks.postMeal2h : DeepLinks.startPostMeal
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular:
        circularView
      case .accessoryInline:
        inlineView
      case .accessoryRectangular:
        rectangularView
      default:
        smallView
      }
    }
    .widgetURL(tapURL)
    .applyingLayoutDirection(layoutDirection(forLang: entry.data?.lang))
  }

  private var smallView: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        ZStack {
          RoundedRectangle(cornerRadius: 13, style: .continuous)
            .fill(SmallPalette.countdown.opacity(SmallPalette.badgeFillOpacity))
          Image(systemName: "timer")
            .font(.system(size: 18, weight: .semibold))
            .foregroundColor(SmallPalette.countdown)
        }
        .frame(width: 40, height: 40)

        Spacer(minLength: 0)

        if runningEnd == nil {
          Image(systemName: "plus")
            .font(.system(size: 14, weight: .heavy))
            .foregroundColor(SmallPalette.countdown)
        }
      }

      Spacer(minLength: 8)

      if let end = runningEnd {
        // Bounded, so it stops at zero instead of counting up past the window
        // the way `style: .timer` does. The lower bound is this entry's own
        // date, which is always before `end` thanks to the guard above -
        // a ClosedRange traps if it is not.
        Text(timerInterval: entry.date...end, countsDown: true)
          .font(.system(size: 26, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .foregroundColor(SmallPalette.countdown)
      }

      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(SmallPalette.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.65)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background {
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .fill(SmallPalette.countdown.opacity(SmallPalette.tileFillOpacity))
    }
    .overlay {
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .strokeBorder(
          SmallPalette.countdown.opacity(SmallPalette.tileStrokeOpacity),
          lineWidth: 1
        )
    }
    .padding(4)
  }

  private var rectangularView: some View {
    HStack(alignment: .center, spacing: 6) {
      Image(systemName: "timer")
        .font(.system(size: 14, weight: .semibold))
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .lineLimit(2)
        .minimumScaleFactor(0.7)
      Spacer(minLength: 2)
      if let end = runningEnd {
        // Same greedy-width trap boxedTimer guards in index.swift: a timer Text
        // asks for the widest string it could ever show, so it is boxed or the
        // narrow accessory frame clips it mid-digit.
        Text(timerInterval: entry.date...end, countsDown: true)
          .font(.system(size: 13, weight: .semibold))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .frame(width: 52, alignment: .trailing)
      } else {
        Image(systemName: "plus")
          .font(.system(size: 11, weight: .heavy))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .foregroundStyle(.primary)
    .widgetAccentable()
  }

  private var inlineView: some View {
    Group {
      if let end = runningEnd {
        Label {
          Text(timerInterval: entry.date...end, countsDown: true)
        } icon: {
          Image(systemName: "timer")
        }
      } else {
        Label { Text(title) } icon: { Image(systemName: "timer") }
      }
    }
    .widgetAccentable()
  }

  private var circularView: some View {
    VStack(spacing: 0) {
      if let end = runningEnd {
        Text(timerInterval: entry.date...end, countsDown: true)
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .frame(width: 46)
        Image(systemName: "timer")
          .font(.system(size: 9, weight: .semibold))
      } else {
        // Idle: the glyph and the "+" that says a tap starts one, with no
        // number to imply something is already running.
        Image(systemName: "timer")
          .font(.system(size: 17, weight: .semibold))
        Image(systemName: "plus")
          .font(.system(size: 8, weight: .heavy))
      }
    }
    .widgetAccentable()
  }
}

// MARK: - Widgets

struct ZerospikeReadingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeReading", provider: SmallTickingProvider()) { entry in
      grounded(SmallReadingView(entry: entry))
    }
    // Gallery-only strings, English for every user: the extension bundle carries
    // no localization catalog (see the note on ZerospikeWidget in index.swift).
    // Journal language only - this tile shows what was logged, nothing else.
    .configurationDisplayName("Last reading")
    .description("The last glucose reading you logged, and when.")
    .supportedFamilies([
      .systemSmall,
      .accessoryRectangular,
      .accessoryInline,
      .accessoryCircular,
    ])
    .containerBackgroundRemovable(false)
  }
}

struct ZerospikeLogGlucoseWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeLogGlucose", provider: SmallStaticProvider()) { entry in
      grounded(SmallActionView(entry: entry, action: smallGlucoseAction(entry.data)))
    }
    .configurationDisplayName("Log glucose")
    .description("Open a glucose entry in one tap.")
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    .containerBackgroundRemovable(false)
  }
}

struct ZerospikeLogMealWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeLogMeal", provider: SmallStaticProvider()) { entry in
      grounded(SmallActionView(entry: entry, action: smallMealAction(entry.data)))
    }
    .configurationDisplayName("Log meal")
    .description("Open a meal entry in one tap.")
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    .containerBackgroundRemovable(false)
  }
}

struct ZerospikeLogInsulinWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeLogInsulin", provider: SmallStaticProvider()) { entry in
      grounded(SmallActionView(entry: entry, action: smallInjectionAction(entry.data)))
    }
    .configurationDisplayName("Log injection")
    .description("Open an injection entry in one tap.")
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    .containerBackgroundRemovable(false)
  }
}

struct ZerospikeTimerWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeTimer", provider: SmallTickingProvider()) { entry in
      grounded(SmallTimerView(entry: entry))
    }
    .configurationDisplayName("Post-meal countdown")
    .description("Time left on a running post-meal countdown, or start one.")
    .supportedFamilies([
      .systemSmall,
      .accessoryRectangular,
      .accessoryInline,
      .accessoryCircular,
    ])
    .containerBackgroundRemovable(false)
  }
}
