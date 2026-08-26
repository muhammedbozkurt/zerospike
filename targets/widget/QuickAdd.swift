import SwiftUI
import WidgetKit

// The Quick Add widget: shortcuts straight into the app's own logging flows (a
// glucose reading, a meal, and - when the profile uses them - an injection and a
// medication), each a deep link the app resolves. Purely navigational, same
// scope as every other glanceable surface: nothing here measures, interprets or
// advises.
//
// Each shortcut carries its own identity colour from the Midnight Monitor
// palette (cyan for glucose, mint for a meal, violet for an injection, amber for
// a medication). The tile is a low-opacity wash of that colour plus a hairline
// of the same hue, so the targets are told apart before the label is read -
// rather than the flat white-6% grey they used to share.
//
// Labels arrive pre-localized in the shared snapshot (lib/services/liveData.ts,
// widget.addGlucose / addMeal / addInjection and the app's own meds.entryLabel);
// the literals below are gallery fallbacks for a device where the app has not
// written a snapshot yet, same policy as the hard-coded complication
// description.

private enum QuickAddPalette {
  static let ink = Color(red: 0.9176, green: 0.9647, blue: 0.9804)       // #eaf6fa
  static let muted = Color(red: 0.5373, green: 0.6392, blue: 0.6902)     // #89a3b0
  /// Per-shortcut identity hues, straight from lib/theme/tokens.ts.
  static let glucose = Color(red: 0.1804, green: 0.9020, blue: 1.0)      // #2ee6ff accent
  static let meal = Color(red: 0.1333, green: 0.8902, blue: 0.6039)      // #22e39a target mint
  static let injection = Color(red: 0.4863, green: 0.3608, blue: 1.0)    // #7c5cff violet
  /// #ffa02a - the one warm hue left once cyan, mint and violet are taken. This
  /// widget prints no reading, so it cannot be misread as a classification.
  static let med = Color(red: 1.0, green: 0.6275, blue: 0.1647)

  /// One place for the tile treatment, so all four tiles stay in step.
  static let tileFillOpacity = 0.16
  static let tileStrokeOpacity = 0.34
  static let badgeFillOpacity = 0.20
}

struct QuickAddShortcut: Identifiable {
  let id: String
  let icon: String
  let label: String
  let tint: Color
  let url: URL?
}

struct QuickAddEntry: TimelineEntry {
  let date: Date
  let labels: LiveData.Labels?
  /// The active in-app language from the snapshot (see LiveData.lang). `nil`
  /// for a missing/undecoded snapshot, which keeps the widget on the device's
  /// own layout direction rather than asserting one.
  let lang: String?
  /// Mirrors the profile's insulin_mode from the snapshot. Defaults to true, so a
  /// snapshot written before the flag existed - or none at all - keeps the
  /// shortcut every build up to now showed.
  var usesInsulin: Bool = true
  /// Mirrors the profile's oral_meds_enabled from the snapshot. Defaults to
  /// FALSE, the other way round from the flag above: this shortcut is new, so a
  /// snapshot written before it existed - or none at all - must keep the widget
  /// exactly as the build that wrote it drew it.
  var usesOralMeds: Bool = false

  /// The logging flows, in the order they are used. The first one is the primary:
  /// it gets the large tile on medium and the whole widget on small. The
  /// injection flow is only offered to a profile that uses insulin, and the
  /// medication flow only to one that tracks medication, matching the app, which
  /// hides those surfaces for the others.
  ///
  /// URLs are exactly the ones the app already answers: `?sheet=glucose` opens
  /// the dashboard's glucose sheet, `?sheet=med` its medication sheet, `/food`
  /// the food tab, `/injection?segment=map` the injection tab's body map.
  /// No new parameters are invented here.
  var shortcuts: [QuickAddShortcut] {
    var items: [QuickAddShortcut] = [
      QuickAddShortcut(
        id: "glucose",
        icon: "drop.fill",
        label: labels?.addGlucose ?? "Glucose",
        tint: QuickAddPalette.glucose,
        url: DeepLinks.addGlucose
      ),
      QuickAddShortcut(
        id: "meal",
        icon: "fork.knife",
        label: labels?.addMeal ?? "Meal",
        tint: QuickAddPalette.meal,
        url: DeepLinks.addMeal
      ),
    ]
    if usesInsulin {
      items.append(
        QuickAddShortcut(
          id: "injection",
          icon: "syringe.fill",
          label: labels?.addInjection ?? "Injection",
          tint: QuickAddPalette.injection,
          url: DeepLinks.addInjection
        )
      )
    }
    if usesOralMeds {
      items.append(
        QuickAddShortcut(
          id: "med",
          icon: "pills.fill",
          label: labels?.addMed ?? "Medication",
          tint: QuickAddPalette.med,
          url: DeepLinks.addMed
        )
      )
    }
    return items
  }
}

struct QuickAddProvider: TimelineProvider {
  /// One read of the shared snapshot per entry, so the labels and the visibility
  /// flags can never come from two different writes. A missing snapshot, a
  /// snapshot that fails to decode, or one written before these flags existed all
  /// land on the same answer: English fallbacks, the injection shortcut shown
  /// (what every build up to now drew) and the medication one hidden.
  private func currentEntry() -> QuickAddEntry {
    let data = LiveDataStore.read()
    return QuickAddEntry(
      date: Date(),
      labels: data?.labels,
      lang: data?.lang,
      usesInsulin: data?.usesInsulin ?? true,
      usesOralMeds: data?.usesOralMeds ?? false
    )
  }

  func placeholder(in context: Context) -> QuickAddEntry {
    currentEntry()
  }

  func getSnapshot(in context: Context, completion: @escaping (QuickAddEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAddEntry>) -> Void) {
    // Nothing here is time-dependent; the app reloads every widget timeline
    // whenever it rewrites the snapshot (data or language change).
    completion(Timeline(entries: [currentEntry()], policy: .never))
  }
}

struct QuickAddWidgetView: View {
  @Environment(\.widgetFamily) private var family
  var entry: QuickAddEntry

  private var eyebrow: String {
    entry.labels?.quickAdd ?? "Quick add"
  }

  var body: some View {
    Group {
      switch family {
      case .systemMedium:
        mediumView
      default:
        smallView
      }
    }
    // Mirrors the app's OWN in-app language, not the device's system
    // language, same as ZerospikeWidgetView in index.swift. No `lang` (older
    // snapshot) leaves the environment untouched, i.e. the device's own
    // direction.
    .applyingLayoutDirection(layoutDirection(forLang: entry.lang))
  }

  /// Small: the primary shortcut (glucose) as one full-bleed identity tile, with
  /// the whole widget as the tap target.
  @ViewBuilder
  private var smallView: some View {
    // Never indexed blindly: the list is built from the snapshot, and an empty
    // widget is a far better failure than a crashed one.
    if let shortcut = entry.shortcuts.first {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .top, spacing: 0) {
          iconBadge(shortcut.icon, tint: shortcut.tint, size: 40, corner: 13, glyph: 18)
          Spacer(minLength: 0)
          Image(systemName: "plus")
            .font(.system(size: 14, weight: .heavy))
            .foregroundColor(shortcut.tint)
        }

        Spacer(minLength: 8)

        Text(eyebrow)
          .font(.system(size: 9, weight: .bold))
          .foregroundColor(QuickAddPalette.muted)
          .lineLimit(1)
          .minimumScaleFactor(0.7)

        Text(shortcut.label)
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(QuickAddPalette.ink)
          .lineLimit(2)
          .minimumScaleFactor(0.7)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .background { tileFill(shortcut.tint, corner: 20) }
      .overlay { tileStroke(shortcut.tint, corner: 20) }
      .padding(4)
      .widgetURL(shortcut.url)
    }
  }

  /// Medium: the primary tile on the left, the remaining flows stacked on the
  /// right. Each is its own Link target. The stack is driven by the list rather
  /// than by fixed indices, so it holds one row, two or three without changing
  /// shape, and cannot be indexed past its end.
  ///
  /// Three rows only fit the medium family's height if they give something up, so
  /// past two the secondary tiles switch to their dense measure rather than being
  /// squeezed by the layout.
  private var mediumView: some View {
    let items = entry.shortcuts
    let dense = items.count > 3
    return VStack(alignment: .leading, spacing: 6) {
      Text(eyebrow)
        .font(.system(size: 9, weight: .bold))
        .foregroundColor(QuickAddPalette.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.leading, 2)

      HStack(spacing: 8) {
        if let primary = items.first {
          linked(primary) { primaryTile(primary) }
        }
        VStack(spacing: dense ? 5 : 8) {
          ForEach(Array(items.dropFirst())) { item in
            linked(item) { rowTile(item, dense: dense) }
          }
        }
      }
    }
    .padding(8)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  /// The primary (first) shortcut, raised: bigger badge, a visible "+" and room
  /// for a two-line label.
  private func primaryTile(_ shortcut: QuickAddShortcut) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        iconBadge(shortcut.icon, tint: shortcut.tint, size: 34, corner: 11, glyph: 16)
        Spacer(minLength: 0)
        Image(systemName: "plus")
          .font(.system(size: 13, weight: .heavy))
          .foregroundColor(shortcut.tint)
      }

      Spacer(minLength: 6)

      Text(shortcut.label)
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(QuickAddPalette.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.65)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background { tileFill(shortcut.tint, corner: 18) }
    .overlay { tileStroke(shortcut.tint, corner: 18) }
  }

  /// A secondary shortcut: badge and label on one line, "+" trailing. `dense` is
  /// the three-in-a-column measure: everything a step smaller, and the label held
  /// to one line, so three of these sit in the height two used to.
  private func rowTile(_ shortcut: QuickAddShortcut, dense: Bool = false) -> some View {
    HStack(spacing: dense ? 6 : 8) {
      iconBadge(
        shortcut.icon,
        tint: shortcut.tint,
        size: dense ? 24 : 28,
        corner: dense ? 8 : 9,
        glyph: dense ? 11 : 13
      )

      Text(shortcut.label)
        .font(.system(size: dense ? 11 : 12, weight: .semibold))
        .foregroundColor(QuickAddPalette.ink)
        .lineLimit(dense ? 1 : 2)
        .minimumScaleFactor(0.6)
        .fixedSize(horizontal: false, vertical: true)

      Spacer(minLength: 4)

      Image(systemName: "plus")
        .font(.system(size: dense ? 10 : 11, weight: .heavy))
        .foregroundColor(shortcut.tint)
    }
    .padding(.horizontal, dense ? 8 : 10)
    .padding(.vertical, dense ? 4 : 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background { tileFill(shortcut.tint, corner: dense ? 14 : 16) }
    .overlay { tileStroke(shortcut.tint, corner: dense ? 14 : 16) }
  }

  /// Wraps a tile in its deep link when it has one (Link works on medium; the
  /// small family uses widgetURL instead).
  @ViewBuilder
  private func linked<Content: View>(
    _ shortcut: QuickAddShortcut,
    @ViewBuilder content: () -> Content
  ) -> some View {
    if let url = shortcut.url {
      Link(destination: url) { content() }
    } else {
      content()
    }
  }

  private func iconBadge(
    _ name: String,
    tint: Color,
    size: CGFloat,
    corner: CGFloat,
    glyph: CGFloat
  ) -> some View {
    ZStack {
      RoundedRectangle(cornerRadius: corner, style: .continuous)
        .fill(tint.opacity(QuickAddPalette.badgeFillOpacity))
      Image(systemName: name)
        .font(.system(size: glyph, weight: .semibold))
        .foregroundColor(tint)
    }
    .frame(width: size, height: size)
  }

  private func tileFill(_ tint: Color, corner: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: corner, style: .continuous)
      .fill(tint.opacity(QuickAddPalette.tileFillOpacity))
  }

  private func tileStroke(_ tint: Color, corner: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: corner, style: .continuous)
      .strokeBorder(tint.opacity(QuickAddPalette.tileStrokeOpacity), lineWidth: 1)
  }
}

struct ZerospikeQuickAddWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeQuickAdd", provider: QuickAddProvider()) { entry in
      if #available(iOS 17.0, *) {
        QuickAddWidgetView(entry: entry)
          .containerBackground(for: .widget) { Color("WidgetBackground") }
      } else {
        QuickAddWidgetView(entry: entry)
          .background(Color("WidgetBackground"))
      }
    }
    // Gallery-only strings, English for every user: the extension bundle carries
    // no localization catalog (see the note on ZerospikeWidget in index.swift).
    // The shortcut labels drawn on the tiles ARE localized - they ride in on the
    // app's snapshot. Purely navigational wording; nothing here claims to measure.
    .configurationDisplayName("Quick add")
    .description("Open a glucose, meal, injection or medication entry in one tap.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .containerBackgroundRemovable(false)
  }
}
